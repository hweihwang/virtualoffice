/**
 * SPDX-FileCopyrightText: 2026 Hoang Pham
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
import type { Cell, Layout } from '../../shared/catalog.ts'
import type { Signal, SignalBody } from '../api.ts'
import type { RoomSession } from './room.ts'

import axios from '@nextcloud/axios'
import { generateOcsUrl } from '@nextcloud/router'
import { reactive } from 'vue'
import { zoneAt } from '../../shared/catalog.ts'
import { positionAt } from '../../shared/movement.ts'
import { falloff, pan, unlockAudio } from './audio.ts'

/** Connect to people within this many cells, and send them your voice. */
export const CONNECT_CELLS = 5
/** Stay connected up to this distance, so walking back and forth does not reconnect. */
export const DISCONNECT_CELLS = 7
/** Full volume this close; silent at CONNECT_CELLS. */
export const FULL_CELLS = 2
export const MAX_PEERS = 6
/** Talk's default STUN server, used when Talk is not there. */
export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.nextcloud.com:443' }]

const TICK_MS = 250
const ANSWER_TIMEOUT_MS = 6000
const GATHER_MAX_MS = 2000
const GATHER_GRACE_MS = 150
const RETRY_AFTER_BYE_MS = 5000
/** Poll quickly for at most this long per person who does not connect. */
const FAST_POLL_MS = 15_000
const SPEAKING_LEVEL = 0.02
const ANALYSER_SIZE = 8192
/** Someone counts as speaking this long after the last sound, so the ring does not flicker between words. */
const SPEAKING_HOLD_MS = 600
/** An offer may arrive before the news that its sender turned voice on. */
const UNKNOWN_SENDER_RETRIES = 4
const UNKNOWN_SENDER_WAIT_MS = 500

export interface VoiceCandidate {
	uid: string
	/** Tab with voice on, or null. */
	session: string | null
	mode: string
	position: Cell
}

/**
 * Who to keep a voice connection with: people with voice on who are open to
 * chat in the same zone, unless it is a quiet zone, at most MAX_PEERS of the
 * nearest. New connections need CONNECT_CELLS or less; existing ones stay up
 * to DISCONNECT_CELLS.
 *
 * @return tab => distance in cells
 */
export function voicePeers(layout: Layout, me: VoiceCandidate, others: VoiceCandidate[], connected: ReadonlySet<string>): Map<string, number> {
	const peers = new Map<string, number>()
	const zone = zoneAt(layout, me.position)
	if (!me.session || me.mode !== 'available' || zone === null || layout.zones.find((z) => z.id === zone)?.quiet) {
		return peers
	}
	others
		.filter((o): o is VoiceCandidate & { session: string } => o.session !== null && o.uid !== me.uid && o.mode === 'available' && zoneAt(layout, o.position) === zone)
		.map((o) => ({ session: o.session, distance: Math.hypot(o.position[0] - me.position[0], o.position[1] - me.position[1]) }))
		.filter((o) => o.distance <= (connected.has(o.session) ? DISCONNECT_CELLS : CONNECT_CELLS))
		.sort((a, b) => a.distance - b.distance)
		.slice(0, MAX_PEERS)
		.forEach((o) => peers.set(o.session, o.distance))
	return peers
}

/** The tab with the smaller session id sends the offer, so two tabs never both do. */
export function isOfferer(own: string, other: string): boolean {
	return own < other
}

/** Signal ids already handled; a signal can arrive by push and again with the poll. */
export class SeenSignals {
	private ids = new Set<number>()

	/** True the first time an id is seen. */
	first(id: number): boolean {
		if (this.ids.has(id)) {
			return false
		}
		this.ids.add(id)
		if (this.ids.size > 500) {
			this.ids.delete(this.ids.values().next().value!)
		}
		return true
	}
}

/** STUN and TURN servers from Talk; its credentials last a day, so ask each time voice turns on. */
export async function talkIceServers(): Promise<RTCIceServer[]> {
	try {
		const response = await axios.get(generateOcsUrl('/apps/spreed/api/v3/signaling/settings'), { headers: { 'OCS-APIRequest': 'true' } })
		const data = response.data.ocs.data as { stunservers?: RTCIceServer[], turnservers?: RTCIceServer[] }
		const servers = [...(data.stunservers ?? []), ...(data.turnservers ?? [])].filter((server) => server?.urls)
		return servers.length > 0 ? servers : DEFAULT_ICE_SERVERS
	} catch {
		return DEFAULT_ICE_SERVERS
	}
}

const urlsOf = (servers: RTCIceServer[]) => servers.flatMap((server) => Array.isArray(server.urls) ? server.urls : [server.urls])

interface Peer {
	session: string
	uid: string
	pc: RTCPeerConnection
	/** Candidate types gathered so far: host, srflx, relay. */
	candidates: Set<string>
	offeredAt: number
	/** Sends the microphone; its track is null while the peer is out of range. */
	sender: RTCRtpSender | null
	sending: boolean
	audio: HTMLAudioElement | null
	gain: GainNode | null
	panner: StereoPannerNode | null
	analyser: AnalyserNode | null
}

export interface VoiceOptions {
	iceServers: () => Promise<RTCIceServer[]>
	/** 0 to 100. */
	volume: () => number
	mode: () => 'push' | 'open'
}

/**
 * Proximity voice: a WebRTC connection to each person close by, set up
 * through the office's signals. Audio goes from browser to browser, or
 * through Talk's TURN server; it never reaches PHP and is not recorded.
 *
 * No trickle ICE: each side waits for its candidates and sends one SDP, as
 * Client Push may drop messages sent in a burst.
 */
export class VoiceMesh {
	readonly state = reactive({
		on: false,
		starting: false,
		/** 'denied' or 'unavailable' when the microphone could not be opened. */
		error: '',
		/** Push to talk: the key or button is held. */
		talking: false,
		/** Open mic: muted with M. */
		muted: false,
		/** People you are connected to. */
		connected: [] as string[],
		/** People whose voice you hear right now, and you while you speak. */
		speaking: [] as string[],
	})

	private stream: MediaStream | null = null
	private local: AnalyserNode | null = null
	private peers = new Map<string, Peer>()
	private retryAfter = new Map<string, number>()
	/** Since when each person close by waits to be connected. */
	private waitingSince = new Map<string, number>()
	private seen = new SeenSignals()
	private servers: RTCIceServer[] = DEFAULT_ICE_SERVERS
	private timer: ReturnType<typeof setInterval> | null = null
	/** About 170 ms of sound per check, so short syllables are not missed between ticks. */
	private samples = new Uint8Array(ANALYSER_SIZE)
	private spokeAt = new Map<string, number>()

	constructor(
		private session: RoomSession,
		private options: VoiceOptions,
	) {}

	/** Call from the click that turns voice on: the browser asks for the microphone. */
	async start(): Promise<void> {
		if (this.state.on || this.state.starting) {
			return
		}
		this.state.starting = true
		this.state.error = ''
		const context = unlockAudio()
		try {
			const [stream, servers] = await Promise.all([
				navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
				this.options.iceServers(),
			])
			if (!this.state.starting) {
				// Turned off or left while the browser asked for the microphone.
				stream.getTracks().forEach((track) => track.stop())
				return
			}
			this.stream = stream
			this.servers = servers
		} catch (error) {
			this.state.error = (error as DOMException)?.name === 'NotAllowedError' ? 'denied' : 'unavailable'
			this.state.starting = false
			return
		}
		if (context) {
			this.local = context.createAnalyser()
			this.local.fftSize = ANALYSER_SIZE
			context.createMediaStreamSource(this.stream).connect(this.local)
		}
		this.state.talking = false
		this.state.muted = false
		this.applyMic()
		await this.session.setVoice(true)
		if (!this.state.starting) {
			// Turned off meanwhile: make sure the server has it off too.
			this.release()
			await this.session.setVoice(false)
			return
		}
		if (!this.session.state.people.find((p) => p.isYou)?.voice) {
			this.release()
			this.state.error = 'unavailable'
			return
		}
		this.session.onSignals = (signals) => signals.forEach((signal) => this.receive(signal))
		this.state.on = true
		this.state.starting = false
		this.timer = setInterval(() => this.tick(), TICK_MS)
		this.tick()
	}

	/** Hangs up, closes the microphone and tells the server. */
	async stop(): Promise<void> {
		if (!this.state.on && !this.state.starting) {
			return
		}
		for (const session of [...this.peers.keys()]) {
			this.close(session, true)
		}
		this.release()
		if (this.session.isActive) {
			await this.session.setVoice(false)
		}
	}

	/** Releases everything without telling anyone, e.g. when the visit ended. */
	dispose(): void {
		for (const session of [...this.peers.keys()]) {
			this.close(session, false)
		}
		this.release()
	}

	/** Push to talk: true while V or the Talk button is held. */
	setTalking(down: boolean): void {
		this.state.talking = down
		this.applyMic()
	}

	toggleMute(): void {
		this.state.muted = !this.state.muted
		this.applyMic()
	}

	/** A signal from Client Push or the poll. */
	receive(signal: Signal): void {
		if (!this.state.on || (signal.to !== undefined && signal.to !== this.session.sessionId) || !this.seen.first(signal.id)) {
			return
		}
		void this.handle(signal.from, signal.body).catch(() => this.close(signal.from, true))
	}

	/** Waits a little for the room to show the sender with voice on. */
	private async sender(from: string): Promise<string | null> {
		for (let attempt = 0; ; attempt++) {
			const person = this.session.state.people.find((p) => p.voice === from)
			if (person || attempt >= UNKNOWN_SENDER_RETRIES || !this.state.on) {
				return person?.uid ?? null
			}
			await new Promise((resolve) => setTimeout(resolve, UNKNOWN_SENDER_WAIT_MS))
		}
	}

	private release(): void {
		if (this.timer !== null) {
			clearInterval(this.timer)
			this.timer = null
		}
		this.stream?.getTracks().forEach((track) => track.stop())
		this.stream = null
		this.local?.disconnect()
		this.local = null
		this.session.onSignals = null
		this.session.setFastPoll(false)
		this.waitingSince.clear()
		this.state.on = false
		this.state.starting = false
		this.state.connected = []
		this.state.speaking = []
	}

	/** The microphone sends only while you talk, or always in open mic unless muted. */
	private applyMic(): void {
		const track = this.stream?.getAudioTracks()[0]
		if (track) {
			track.enabled = this.options.mode() === 'push' ? this.state.talking : !this.state.muted
		}
	}

	private async handle(from: string, body: SignalBody): Promise<void> {
		if (body.type === 'bye') {
			this.close(from, false)
			this.retryAfter.set(from, Date.now() + RETRY_AFTER_BYE_MS)
			return
		}
		if (body.type === 'answer') {
			const peer = this.peers.get(from)
			if (peer && peer.pc.signalingState === 'have-local-offer') {
				await peer.pc.setRemoteDescription({ type: 'answer', sdp: body.sdp })
			}
			return
		}
		// An offer: accept it when the sender is close enough by your own view of the room.
		const uid = await this.sender(from)
		if (uid === null || !this.nearby(true).has(from)) {
			void this.session.signal(from, { type: 'bye' }).catch(() => {})
			return
		}
		this.close(from, false)
		const peer = this.createPeer(from, uid)
		await peer.pc.setRemoteDescription({ type: 'offer', sdp: body.sdp })
		await this.attachMic(peer)
		await peer.pc.setLocalDescription(await peer.pc.createAnswer())
		await this.gathered(peer)
		if (this.peers.get(from) === peer && peer.pc.localDescription) {
			await this.session.signal(from, { type: 'answer', sdp: peer.pc.localDescription.sdp })
		}
	}

	private async offer(session: string, uid: string): Promise<void> {
		const peer = this.createPeer(session, uid)
		await this.attachMic(peer)
		await peer.pc.setLocalDescription(await peer.pc.createOffer())
		await this.gathered(peer)
		if (this.peers.get(session) === peer && peer.pc.localDescription) {
			peer.offeredAt = Date.now()
			await this.session.signal(session, { type: 'offer', sdp: peer.pc.localDescription.sdp })
		}
	}

	private createPeer(session: string, uid: string): Peer {
		const pc = new RTCPeerConnection({ iceServers: this.servers })
		const peer: Peer = { session, uid, pc, candidates: new Set(), offeredAt: Date.now(), sender: null, sending: false, audio: null, gain: null, panner: null, analyser: null }
		pc.addEventListener('icecandidate', (event) => event.candidate?.type && peer.candidates.add(event.candidate.type))
		pc.addEventListener('track', (event) => this.play(peer, event.streams[0] ?? new MediaStream([event.track])))
		pc.addEventListener('connectionstatechange', () => {
			if (pc.connectionState === 'failed') {
				this.close(session, true)
				this.retryAfter.set(session, Date.now() + RETRY_AFTER_BYE_MS)
			}
		})
		this.peers.set(session, peer)
		return peer
	}

	/**
	 * Sends the microphone over the offer's audio line, or a new one when
	 * offering. Safari would otherwise add a second line nobody negotiated.
	 */
	private async attachMic(peer: Peer): Promise<void> {
		const track = this.stream?.getAudioTracks()[0]
		if (!track || !this.stream) {
			return
		}
		const offered = peer.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio' && t.sender.track === null)
		if (offered) {
			offered.direction = 'sendrecv'
			await offered.sender.replaceTrack(track)
			offered.sender.setStreams?.(this.stream)
			peer.sender = offered.sender
		} else {
			peer.sender = peer.pc.addTransceiver(track, { direction: 'sendrecv', streams: [this.stream] }).sender
		}
		peer.sending = true
	}

	/**
	 * Waits for ICE candidates: until gathering completes, or shortly after
	 * the TURN server answered (or, without TURN, the STUN server), 2 seconds
	 * at most. Machines with several network interfaces often never report
	 * "complete", and networks that only let TURN through never answer STUN.
	 */
	private gathered(peer: Peer): Promise<void> {
		const urls = urlsOf(this.servers)
		const wantSrflx = urls.some((url) => url.startsWith('stun:'))
		const wantRelay = urls.some((url) => url.startsWith('turn:') || url.startsWith('turns:'))
		const started = Date.now()
		return new Promise((resolve) => {
			const check = () => {
				const { candidates, pc } = peer
				// A relay always gives a route; without TURN, the own and the STUN address are what there is.
				const enough = wantRelay ? candidates.has('relay') : candidates.has('host') && (!wantSrflx || candidates.has('srflx'))
				if (pc.iceGatheringState === 'complete' || Date.now() - started >= GATHER_MAX_MS || pc.signalingState === 'closed') {
					resolve()
				} else if (enough) {
					setTimeout(resolve, GATHER_GRACE_MS)
				} else {
					setTimeout(check, 20)
				}
			}
			check()
		})
	}

	/**
	 * Remote voice: a muted <audio> element keeps Chrome decoding the stream
	 * (crbug 933677), the sound itself goes through gain and stereo panning.
	 */
	private play(peer: Peer, stream: MediaStream): void {
		const context = unlockAudio()
		const audio = new Audio()
		audio.muted = true
		audio.srcObject = stream
		void audio.play().catch(() => {})
		peer.audio = audio
		if (!context) {
			return
		}
		const source = context.createMediaStreamSource(stream)
		peer.analyser = context.createAnalyser()
		peer.analyser.fftSize = ANALYSER_SIZE
		peer.gain = context.createGain()
		peer.gain.gain.value = 0
		peer.panner = context.createStereoPanner()
		source.connect(peer.analyser)
		source.connect(peer.gain).connect(peer.panner).connect(context.destination)
	}

	private close(session: string, tell: boolean): void {
		const peer = this.peers.get(session)
		if (!peer) {
			return
		}
		this.peers.delete(session)
		peer.pc.close()
		peer.gain?.disconnect()
		peer.panner?.disconnect()
		peer.analyser?.disconnect()
		if (peer.audio) {
			peer.audio.srcObject = null
		}
		if (tell) {
			void this.session.signal(session, { type: 'bye' }).catch(() => {})
		}
	}

	/** People to be connected with, from the paths everyone already has. */
	private nearby(generous = false): Map<string, number> {
		const t = this.session.clock.serverNow()
		const me = this.session.state.people.find((p) => p.isYou)
		const position = (uid: string): Cell => {
			const motion = this.session.motions.get(uid)
			return motion ? positionAt(motion.trajectory, t) : [-99, -99]
		}
		if (!me) {
			return new Map()
		}
		const others = this.session.state.people.filter((p) => !p.isYou)
		const connected = generous ? new Set(others.map((p) => p.voice ?? '')) : new Set(this.peers.keys())
		return voicePeers(
			this.session.layoutData,
			{ uid: me.uid, session: me.voice, mode: me.mode, position: position(me.uid) },
			others.map((p) => ({ uid: p.uid, session: p.voice, mode: p.mode, position: position(p.uid) })),
			connected,
		)
	}

	private tick(): void {
		if (!this.state.on) {
			return
		}
		const own = this.session.sessionId
		const wanted = this.nearby()
		const now = Date.now()
		for (const session of [...this.peers.keys()]) {
			if (!wanted.has(session)) {
				this.close(session, true)
			}
		}
		for (const [session, peer] of this.peers) {
			// No answer in time: start over with a fresh offer.
			if (isOfferer(own, session) && peer.pc.signalingState === 'have-local-offer' && now - peer.offeredAt > ANSWER_TIMEOUT_MS) {
				this.close(session, false)
			}
		}
		for (const session of wanted.keys()) {
			const person = this.session.state.people.find((p) => p.voice === session)
			if (person && !this.peers.has(session) && isOfferer(own, session) && (this.retryAfter.get(session) ?? 0) <= now) {
				void this.offer(session, person.uid).catch(() => this.close(session, true))
			}
		}
		this.mix(wanted)
		// Without Client Push, both sides poll quickly until everyone close by is connected.
		for (const session of [...this.waitingSince.keys()]) {
			if (!wanted.has(session) || this.peers.get(session)?.pc.connectionState === 'connected') {
				this.waitingSince.delete(session)
			}
		}
		for (const session of wanted.keys()) {
			if (this.peers.get(session)?.pc.connectionState !== 'connected' && !this.waitingSince.has(session)) {
				this.waitingSince.set(session, now)
			}
		}
		this.session.setFastPoll([...this.waitingSince.values()].some((since) => now - since < FAST_POLL_MS))
	}

	/** Volume and side by distance; your voice goes only to people within CONNECT_CELLS. */
	private mix(wanted: Map<string, number>): void {
		const t = this.session.clock.serverNow()
		const mine = this.session.motions.get(this.session.state.people.find((p) => p.isYou)?.uid ?? '')
		const here = mine ? positionAt(mine.trajectory, t) : null
		const volume = this.options.volume() / 100
		const connected: string[] = []
		const speaking: string[] = []
		for (const [session, peer] of this.peers) {
			const distance = wanted.get(session) ?? DISCONNECT_CELLS
			const sending = distance <= CONNECT_CELLS
			if (peer.sender && sending !== peer.sending) {
				peer.sending = sending
				void peer.sender.replaceTrack(sending ? this.stream?.getAudioTracks()[0] ?? null : null).catch(() => {})
			}
			if (peer.pc.connectionState === 'connected') {
				connected.push(peer.uid)
			}
			const motion = this.session.motions.get(peer.uid)
			const context = peer.gain?.context
			if (peer.gain && peer.panner && context) {
				peer.gain.gain.setTargetAtTime(volume * falloff(distance, FULL_CELLS, CONNECT_CELLS), context.currentTime, 0.1)
				const dx = here && motion ? positionAt(motion.trajectory, t)[0] - here[0] : 0
				peer.panner.pan.setTargetAtTime(pan(dx, CONNECT_CELLS), context.currentTime, 0.1)
			}
			if (peer.analyser && this.level(peer.analyser) > SPEAKING_LEVEL && falloff(distance, FULL_CELLS, CONNECT_CELLS) > 0) {
				this.spokeAt.set(peer.uid, Date.now())
			}
			if (Date.now() - (this.spokeAt.get(peer.uid) ?? 0) < SPEAKING_HOLD_MS) {
				speaking.push(peer.uid)
			}
		}
		const me = this.session.state.people.find((p) => p.isYou)
		const micOn = this.stream?.getAudioTracks()[0]?.enabled ?? false
		if (me && micOn && this.local && this.level(this.local) > SPEAKING_LEVEL) {
			this.spokeAt.set(me.uid, Date.now())
		}
		if (me && micOn && Date.now() - (this.spokeAt.get(me.uid) ?? 0) < SPEAKING_HOLD_MS) {
			speaking.push(me.uid)
		}
		if (connected.join() !== this.state.connected.join()) {
			this.state.connected = connected
		}
		if (speaking.join() !== this.state.speaking.join()) {
			this.state.speaking = speaking
		}
	}

	/** Loudness as root mean square, 0 to 1. */
	private level(analyser: AnalyserNode): number {
		analyser.getByteTimeDomainData(this.samples)
		let sum = 0
		for (const value of this.samples) {
			sum += ((value - 128) / 128) ** 2
		}
		return Math.sqrt(sum / this.samples.length)
	}
}
