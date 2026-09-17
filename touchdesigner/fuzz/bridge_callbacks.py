"""Authenticated, allowlisted control messages for the local fuzz network.

The builder copies this module into a Text DAT. It deliberately has no Python
execution, file access, or operator-path commands in its wire protocol.
"""

import hmac
import json
import math
import secrets
import time

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 8192
CHORD_INDEX = {"c9sus4": 0, "dm7": 1, "gm": 2}
DEFAULT_PARAMETERS = {
    "visual.fuzz.amount": 0.2,
    "visual.fuzz.feedback": 0.65,
    "output.blackout": False,
}
CAPABILITIES = {
    "modules": ["visuals", "output"],
    "scenes": ["fuzz"],
    "audioPresets": [],
    "parameters": list(DEFAULT_PARAMETERS),
    "cameraDevices": [],
    "audioDevices": [],
    "outputDisplays": [],
}


def _clients(server):
    return server.fetch("fuzzClients", {}, storeDefault=True)


def _state(server):
    return server.parent().fetch("fuzzState", {
        "revision": 0,
        "running": False,
        "sessionId": None,
        "parameters": dict(DEFAULT_PARAMETERS),
    }, storeDefault=True)


def _send(server, client, message):
    server.webSocketSendText(client, json.dumps(message, allow_nan=False))


def _error(server, client, code, message, recoverable=True):
    _send(server, client, {
        "type": "error", "code": code,
        "message": message, "recoverable": recoverable,
    })


def _close(server, client):
    server.webSocketClose(client)
    onWebSocketClose(server, client)


def _snapshot(server, client):
    _send(server, client, {"type": "state.snapshot", "state": _state(server)})


def _changed(server):
    _state(server)["revision"] += 1
    for client, authenticated in list(_clients(server).items()):
        if authenticated:
            _snapshot(server, client)


def _finite_number(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def _reset_hit(server):
    server.parent().op("CHORD").par.value1 = 0.0
    server.parent().store("lastHitAt", -1000.0)


def hit_level(server):
    """A short pulse that returns to zero even if the app stops sending."""
    elapsed = max(0.0, time.monotonic() - server.parent().fetch("lastHitAt", -1000.0))
    strength = server.parent().op("CHORD").par.value1.eval()
    return strength * max(0.0, 1.0 - elapsed / 0.25)


def onHTTPRequest(webServerDAT, request, response):
    # The browser's control protocol is WebSocket-only; HTTP exposes no state.
    response["statusCode"] = 404
    response["statusReason"] = "Not Found"
    response["data"] = ""
    return response


def onWebSocketOpen(webServerDAT, client, uri):
    if uri != "/body-synth":
        webServerDAT.webSocketClose(client)
        return
    _clients(webServerDAT)[client] = False


def onWebSocketClose(webServerDAT, client):
    was_authenticated = _clients(webServerDAT).pop(client, False)
    if was_authenticated and not any(_clients(webServerDAT).values()):
        _reset_hit(webServerDAT)
        _state(webServerDAT)["running"] = False
        _state(webServerDAT)["revision"] += 1


def onServerStop(webServerDAT):
    webServerDAT.store("fuzzClients", {})
    _reset_hit(webServerDAT)
    _state(webServerDAT)["running"] = False


def _require_loopback(server):
    address = getattr(server.par, "localaddress", None)
    if address is None or address.eval() != "127.0.0.1":
        server.par.active = False
        onServerStop(server)
        raise RuntimeError("The fuzz bridge requires a 127.0.0.1 binding (TouchDesigner 2025.33070+).")


def _mark_runtime_storage(server):
    # TouchDesigner substitutes these values when saving/loading storage.
    # The export preparation below also clears the live values before saving.
    server.parent().storeStartupValue("pairingCode", None)
    server.parent().storeStartupValue("lastHitAt", -1000.0)
    server.storeStartupValue("fuzzClients", {})


def onServerStart(webServerDAT):
    _require_loopback(webServerDAT)
    _mark_runtime_storage(webServerDAT)
    onServerStop(webServerDAT)
    code = webServerDAT.parent().fetch("pairingCode", None)
    if not isinstance(code, str) or not code.isascii() or not 8 <= len(code) <= 128:
        webServerDAT.parent().store("pairingCode", secrets.token_urlsafe(24))


def start_bridge(server):
    """Start only after binding is checked, including when opening a .toe."""
    server.par.active = False
    address = getattr(server.par, "localaddress", None)
    if address is None:
        _require_loopback(server)
    address.val = "127.0.0.1"
    onServerStart(server)
    server.par.active = True


def prepare_for_export(server):
    """Sanitize only fuzz runtime state, leaving the listener off for saving.

    The embedded startup DAT calls start_bridge() when the exported project
    opens. No pairing code is needed or generated during this preparation.
    """
    server.par.active = False
    onServerStop(server)
    _mark_runtime_storage(server)
    server.parent().store("pairingCode", None)
    state = _state(server)
    state.update(revision=0, running=False, sessionId=None)
    server.parent().op("CHORD").par.value0 = 0.0


def onWebSocketReceiveText(webServerDAT, client, data):
    if client not in _clients(webServerDAT):
        webServerDAT.webSocketClose(client)
        return
    try:
        valid_size = isinstance(data, str) and len(data.encode("utf-8")) <= MAX_MESSAGE_BYTES
    except UnicodeEncodeError:
        valid_size = False
    if not valid_size:
        _error(webServerDAT, client, "invalid_message", "Message is too large.", False)
        _close(webServerDAT, client)
        return
    try:
        message = json.loads(data)
    except (ValueError, TypeError, RecursionError):
        _error(webServerDAT, client, "invalid_message", "Expected a JSON object.")
        return
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        _error(webServerDAT, client, "invalid_message", "Expected a typed JSON object.")
        return

    kind = message["type"]
    if kind == "hello":
        version = message.get("protocolVersion")
        client_id = message.get("clientId")
        pairing = message.get("pairingCode")
        expected = webServerDAT.parent().fetch("pairingCode", "")
        if type(version) is not int or version != PROTOCOL_VERSION:
            _error(webServerDAT, client, "protocol_version", "Unsupported protocol version.", False)
            _close(webServerDAT, client)
            return
        if not isinstance(client_id, str) or not 1 <= len(client_id) <= 128:
            _error(webServerDAT, client, "invalid_message", "A client identifier is required.", False)
            _close(webServerDAT, client)
            return
        if (not isinstance(pairing, str) or not pairing.isascii() or not expected
                or len(pairing) > 128 or not hmac.compare_digest(pairing, expected)):
            _error(webServerDAT, client, "authentication", "Pairing code was not accepted.", False)
            _close(webServerDAT, client)
            return
        _clients(webServerDAT)[client] = True
        _send(webServerDAT, client, {
            "type": "welcome", "protocolVersion": PROTOCOL_VERSION,
            "engineVersion": "fuzz-1", "capabilities": CAPABILITIES,
        })
        _snapshot(webServerDAT, client)
        return

    if not _clients(webServerDAT)[client]:
        _error(webServerDAT, client, "authentication", "Pair with the engine first.", False)
        _close(webServerDAT, client)
        return

    if kind == "ping":
        sent_at = message.get("sentAt")
        if not _finite_number(sent_at):
            _error(webServerDAT, client, "invalid_message", "Ping timestamp must be finite.")
            return
        _send(webServerDAT, client, {
            "type": "pong", "sentAt": sent_at, "receivedAt": time.time() * 1000,
        })
    elif kind == "parameter.set":
        parameter = message.get("parameter")
        value = message.get("value")
        parameters = _state(webServerDAT)["parameters"]
        if not isinstance(parameter, str) or parameter not in DEFAULT_PARAMETERS:
            _error(webServerDAT, client, "unsupported_parameter", "Unknown parameter.")
            return
        if parameter == "output.blackout":
            valid = isinstance(value, bool)
        else:
            maximum = 0.98 if parameter == "visual.fuzz.feedback" else 1.0
            valid = _finite_number(value) and 0.0 <= value <= maximum
        if not valid:
            _error(webServerDAT, client, "invalid_parameter", "Parameter value is outside its range.")
            return
        parameters[parameter] = value
        channel = list(DEFAULT_PARAMETERS).index(parameter)
        getattr(webServerDAT.parent().op("CONTROLS").par, "value" + str(channel)).val = value
        _changed(webServerDAT)
    elif kind == "transport.set":
        playing = message.get("playing")
        if not isinstance(playing, bool):
            _error(webServerDAT, client, "invalid_message", "Playing must be a boolean.")
            return
        _state(webServerDAT)["running"] = playing
        if not playing:
            _reset_hit(webServerDAT)
        _changed(webServerDAT)
    elif kind == "event":
        name = message.get("name")
        payload = message.get("payload")
        if not isinstance(payload, dict):
            _error(webServerDAT, client, "invalid_message", "Event payload must be an object.")
            return
        if name == "song.chord":
            chord = payload.get("chordId")
            if not isinstance(chord, str) or chord not in CHORD_INDEX:
                _error(webServerDAT, client, "invalid_message", "Unknown song chord.")
                return
            webServerDAT.parent().op("CHORD").par.value0 = CHORD_INDEX[chord]
        elif name == "note.hit":
            chord_tone, strength = payload.get("chordTone"), payload.get("strength")
            if not isinstance(chord_tone, bool) or not _finite_number(strength) or not 0 <= strength <= 1:
                _error(webServerDAT, client, "invalid_message", "Invalid note hit.")
                return
            webServerDAT.parent().op("CHORD").par.value1 = strength if chord_tone else 0.0
            webServerDAT.parent().store("lastHitAt", time.monotonic())
        else:
            _error(webServerDAT, client, "unsupported_event", "Unknown event.")
    else:
        _error(webServerDAT, client, "unsupported_message", "Unknown command.")


def onWebSocketReceiveBinary(webServerDAT, client, data):
    _error(webServerDAT, client, "invalid_message", "Only JSON text is supported.", False)
    _close(webServerDAT, client)
