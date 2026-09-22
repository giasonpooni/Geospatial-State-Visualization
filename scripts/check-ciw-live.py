"""Drive the installed CIW and native GSV read client in one bounded gate.

CI selects an exact CIW checkout before installing its wheel. This script never
chooses a revision, imports a checkout by sys.path, or substitutes a provider.
"""
from __future__ import annotations

import argparse
import asyncio
import base64
import json
from pathlib import Path
import tempfile

from websockets.asyncio.server import serve

from ciw.instruments import make_demo_run
from ciw.server import WorkbenchServer
from ciw.session import Session


async def check(source_path: Path):
    with tempfile.TemporaryDirectory(prefix="gsv-ciw-live-") as directory:
        session = Session(make_demo_run(), Path(directory))
        source = session.workbench.add_source({"kind": "geographic-context", "label": "Native GSV live gate",
            "bytes_b64": base64.b64encode(source_path.read_bytes()).decode("ascii")})
        bridge = WorkbenchServer(session, spatial_view_origins=["http://127.0.0.1:5173"])
        async with serve(bridge.handler, "127.0.0.1", 0) as listener:
            port = listener.sockets[0].getsockname()[1]
            process = await asyncio.create_subprocess_exec("node", "scripts/check-ciw-workbench.mjs",
                f"ws://127.0.0.1:{port}/spatial", source["source_id"],
                cwd=Path(__file__).resolve().parents[1], stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE)
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), 30)
            except BaseException:
                process.kill()
                await process.communicate()
                raise
            print(stdout.decode(), end="")
            if process.returncode != 0:
                raise RuntimeError(f"Native GSV client failed ({process.returncode}): {stderr.decode()}")
            if not json.loads(stdout)["native_provider"] == "passed":
                raise RuntimeError("Native provider did not report a completed check")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    asyncio.run(check(parser.parse_args().source.resolve()))
