"""Seekable file object over HTTP Range requests, so h5py can read a window of a remote NISAR HDF5 file.

Adapted from the team's 2 Nov exploration script (scripts/nisar_stream.py).
"""
import io
import time

import requests


class HTTPRangeFile(io.RawIOBase):
    def __init__(self, url: str, session: requests.Session, block: int = 4 * 1024 * 1024):
        self.block = block
        self.pos = 0
        self.cache: dict[int, bytes] = {}
        self.bytes_fetched = 0
        self.requests = 0
        # Resolve the signed final URL once (valid about an hour), so later ranges skip the login redirect.
        r = session.get(url, headers={"Range": "bytes=0-0"}, allow_redirects=True, timeout=120)
        r.raise_for_status()
        self.url = r.url
        self.size = int(r.headers["Content-Range"].split("/")[-1])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def _get_block(self, i: int) -> bytes:
        if i not in self.cache:
            start = i * self.block
            end = min(start + self.block, self.size) - 1
            for attempt in range(5):
                try:
                    r = requests.get(self.url, headers={"Range": f"bytes={start}-{end}"}, timeout=120)
                    r.raise_for_status()
                    break
                except requests.RequestException:
                    if attempt == 4:
                        raise
                    time.sleep(2 * (attempt + 1))
            self.cache[i] = r.content
            self.bytes_fetched += len(r.content)
            self.requests += 1
        return self.cache[i]

    def prefetch(self, ranges: list[tuple[int, int]], workers: int = 16) -> None:
        """Fetch every block that the given (offset, size) byte ranges touch, in parallel, into the cache."""
        from concurrent.futures import ThreadPoolExecutor

        blocks = sorted({i for off, size in ranges for i in range(off // self.block, (off + size - 1) // self.block + 1)} - set(self.cache))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            list(ex.map(self._get_block, blocks))

    def readinto(self, b):
        n = len(b)
        if self.pos >= self.size or n == 0:
            return 0
        n = min(n, self.size - self.pos)
        out = memoryview(b)
        done = 0
        while done < n:
            p = self.pos + done
            i, off = divmod(p, self.block)
            chunk = self._get_block(i)[off: off + (n - done)]
            out[done: done + len(chunk)] = chunk
            done += len(chunk)
        self.pos += n
        return n
