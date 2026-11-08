from contextlib import contextmanager

from fastapi import HTTPException


@contextmanager
def permit(slots):
    if not slots.acquire(blocking=False):
        raise HTTPException(503, "Voice engine is busy.")
    try:
        yield
    finally:
        slots.release()
