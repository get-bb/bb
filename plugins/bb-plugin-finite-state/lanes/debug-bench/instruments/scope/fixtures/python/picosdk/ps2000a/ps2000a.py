"""FFI-call-level ps2000a stand-in for WP-94 tests.

Shape authority: PicoScope 2000 Series (A API) Programmer's Guide ps2000apg
sections 3.25, 3.37, 3.39-3.40, 3.56, 3.65, and Pico's Python wrappers.
"""

import json
import os

PS2000A_COUPLING = {"PS2000A_DC": 1, "PS2000A_AC": 0}
PS2000A_CHANNEL = {
    "PS2000A_CHANNEL_A": 0,
    "PS2000A_CHANNEL_B": 1,
    "PS2000A_CHANNEL_C": 2,
    "PS2000A_CHANNEL_D": 3,
}
PS2000A_RANGE = {
    key: index
    for index, key in enumerate(
        [
            "PS2000A_10MV",
            "PS2000A_20MV",
            "PS2000A_50MV",
            "PS2000A_100MV",
            "PS2000A_200MV",
            "PS2000A_500MV",
            "PS2000A_1V",
            "PS2000A_2V",
            "PS2000A_5V",
            "PS2000A_10V",
            "PS2000A_20V",
        ]
    )
}
PS2000A_THRESHOLD_DIRECTION = {"PS2000A_RISING": 2, "PS2000A_FALLING": 3}
PS2000A_WAVE_TYPE = {"PS2000A_SINE": 0}
PS2000A_SWEEP_TYPE = {"PS2000A_UP": 0}
PS2000A_EXTRA_OPERATIONS = {"PS2000A_ES_OFF": 0}
PS2000A_SIGGEN_TRIG_TYPE = {"PS2000A_SIGGEN_RISING": 0}
PS2000A_SIGGEN_TRIG_SOURCE = {"PS2000A_SIGGEN_NONE": 0}

_buffers = {}


def _value(value):
    return value.value if hasattr(value, "value") else value


def _log(name, *args):
    path = os.environ.get("FS_SCOPE_PROTOCOL_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(
                json.dumps({"call": name, "args": [_value(arg) for arg in args]})
                + "\n"
            )


def ps2000aEnumerateUnits(count, serials, length):
    _log("ps2000aEnumerateUnits")
    count._obj.value = 1
    serials.value = b"PICO-001"
    length._obj.value = len(serials.value)
    return 0


def ps2000aOpenUnit(handle, serial):
    _log("ps2000aOpenUnit", serial.decode("ascii") if serial else None)
    handle._obj.value = 7
    return 0


def ps2000aSetChannel(handle, channel, enabled, coupling, range_id, offset):
    _log("ps2000aSetChannel", handle, channel, enabled, coupling, range_id, offset)
    return 0


def ps2000aSetSimpleTrigger(handle, enabled, source, threshold, direction, delay, auto_trigger_ms):
    _log(
        "ps2000aSetSimpleTrigger",
        handle,
        enabled,
        source,
        threshold,
        direction,
        delay,
        auto_trigger_ms,
    )
    return 0


def ps2000aGetTimebase2(
    handle, timebase, samples, interval_ns, oversample, max_samples, segment
):
    interval = (2 ** timebase) if timebase <= 2 else (timebase - 2) * 8
    interval_ns._obj.value = interval
    max_samples._obj.value = 10_000_000
    _log(
        "ps2000aGetTimebase2",
        handle,
        timebase,
        samples,
        interval_ns._obj.value,
        oversample,
        max_samples._obj.value,
        segment,
    )
    return 0


def ps2000aSetDataBuffer(handle, channel, buffer, samples, segment, ratio_mode):
    _log("ps2000aSetDataBuffer", handle, channel, samples, segment, ratio_mode)
    _buffers[channel] = buffer
    return 0


def ps2000aRunBlock(handle, pre, post, timebase, oversample, time_indisposed, segment, callback, parameter):
    _log("ps2000aRunBlock", handle, pre, post, timebase, oversample, segment)
    time_indisposed._obj.value = 1
    return 0


def ps2000aIsReady(handle, ready):
    _log("ps2000aIsReady", handle)
    ready._obj.value = 0 if os.environ.get("FS_SCOPE_PICO_NO_TRIGGER") == "1" else 1
    return 0


def ps2000aGetValues(handle, start, count, ratio, ratio_mode, segment, overflow):
    _log("ps2000aGetValues", handle, start, count._obj.value, ratio, ratio_mode, segment)
    for buffer in _buffers.values():
        for index in range(count._obj.value):
            buffer[index] = (index % 51) - 25
    overflow._obj.value = 0
    return 0


def ps2000aStop(handle):
    _log("ps2000aStop", handle)
    return 0


def ps2000aCloseUnit(handle):
    _log("ps2000aCloseUnit", handle)
    return 0


def ps2000aSetSigGenBuiltIn(*args):
    _log("ps2000aSetSigGenBuiltIn", *args)
    return 0
