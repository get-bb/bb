"""Protocol-faithful PyVISA stand-in for WP-94 tests.

Shape authority: Siglent SDS1000/SDS2000 Programming Guide PG01-E02D,
pages 23, 31-33, 43-44, 184, and 263-265. The fake deliberately exposes
PyVISA's ResourceManager/open_resource/query/write/read_bytes seam rather than
returning a completed Finite State capture.
"""

import json
import os


def _log(operation, value):
    path = os.environ.get("FS_SCOPE_PROTOCOL_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as handle:
            handle.write(json.dumps({"operation": operation, "value": value}) + "\n")


class _Instrument:
    def __init__(self, resource):
        self.resource = resource
        self.timeout = 0
        self.headers_off = False
        self.pending_waveform = None
        self.waveform_response = None

    def query(self, command):
        _log("query", command)
        if command == "*IDN?":
            return os.environ.get(
                "FS_SCOPE_SCPI_IDN", "Siglent,SDS1104X-E,MOCK001,6.1.37R17"
            )
        if command == "SAST?":
            status = os.environ.get("FS_SCOPE_SCPI_STATUS", "Stop")
            return status if self.headers_off else "SAST " + status
        if command == "SARA?":
            return os.environ.get("FS_SCOPE_SCPI_SAMPLE_RATE", "6.25E+07Sa/s")
        if command.endswith(":VDIV?"):
            return os.environ.get("FS_SCOPE_SCPI_VDIV", "1.00E+00V")
        if command.endswith(":OFST?"):
            return os.environ.get("FS_SCOPE_SCPI_OFFSET", "-5.00E-01V")
        raise RuntimeError("unexpected SCPI query: " + command)

    def write(self, command):
        _log("write", command)
        if command == "CHDR OFF":
            self.headers_off = True
        if command.endswith(":WF? DAT2") or command.endswith(":CURVE?"):
            self.pending_waveform = command
            self.waveform_response = None

    def read_bytes(self, count, chunk_size=None, break_on_termchar=False):
        _log(
            "read_bytes",
            {
                "command": self.pending_waveform,
                "count": count,
                "break_on_termchar": break_on_termchar,
            },
        )
        if self.pending_waveform is None:
            raise RuntimeError("read_bytes without a waveform query")
        if self.waveform_response is None:
            raw_size = os.environ.get("FS_SCOPE_SCPI_RAW_SIZE")
            if raw_size is not None:
                raw = b"#9" + str(int(raw_size)).zfill(9).encode("ascii") + b"\n\n"
            else:
                default = "23393030303030303030330019e70a0a"
                raw = bytes.fromhex(os.environ.get("FS_SCOPE_SCPI_RAW_HEX", default))
            if not self.headers_off:
                raw = b"C1:WF DAT2," + raw
            self.waveform_response = raw
        chunk = self.waveform_response[:count]
        self.waveform_response = self.waveform_response[count:]
        return chunk

    def close(self):
        _log("instrument.close", self.resource)


class ResourceManager:
    def __init__(self, backend):
        _log("resource_manager", backend)

    def open_resource(self, resource, open_timeout):
        _log("open_resource", {"resource": resource, "open_timeout": open_timeout})
        return _Instrument(resource)

    def close(self):
        _log("resource_manager.close", "@py")
