def assert_pico_ok(status):
    if status != 0:
        raise RuntimeError("Pico status " + str(status))


channelInputRanges = [
    10,
    20,
    50,
    100,
    200,
    500,
    1000,
    2000,
    5000,
    10000,
    20000,
    50000,
    100000,
    200000,
]


def mV2adc(millivolts, range_id, max_adc):
    return round(millivolts * max_adc.value / channelInputRanges[range_id])


def adc2mV(buffer, range_id, max_adc):
    return [
        sample * channelInputRanges[range_id] / max_adc.value for sample in buffer
    ]
