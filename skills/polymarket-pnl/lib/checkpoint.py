#!/usr/bin/env python3
"""Simple resumable checkpoint manager.

Save / restore long-running task progress with periodic auto-save and
crash recovery. Multi-task isolation via `task_name`.

Usage:
    from checkpoint import Checkpoint

    ckpt = Checkpoint('my_task')
    start_offset = ckpt.get('offset', 0)

    for i, record in enumerate(data[start_offset:], start=start_offset):
        process(record)
        ckpt.update(offset=i + 1, processed=i + 1)

    ckpt.complete()
"""

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# Default: resolve to ./checkpoints/ under the current working directory.
# Override per-instance via the `state_dir` arg if you want a different path.
DEFAULT_STATE_DIR = Path.cwd() / "checkpoints"


class Checkpoint:
    """Resumable checkpoint manager with auto-save."""

    def __init__(
        self,
        task_name: str,
        state_dir: Path = DEFAULT_STATE_DIR,
        auto_save_interval: int = 1000,  # save every N updates
        auto_save_seconds: int = 60,     # or every N seconds, whichever first
    ):
        self.task_name = task_name
        self.state_dir = Path(state_dir)
        self.state_file = self.state_dir / f'{task_name}_checkpoint.json'
        self.auto_save_interval = auto_save_interval
        self.auto_save_seconds = auto_save_seconds

        self._state: dict[str, Any] = {}
        self._update_count = 0
        self._last_save_time = time.time()
        self._started_at: Optional[str] = None

        self.state_dir.mkdir(parents=True, exist_ok=True)

    def load(self) -> dict[str, Any]:
        """Load checkpoint from disk if it exists."""
        if self.state_file.exists():
            try:
                data = json.loads(self.state_file.read_text(encoding='utf-8'))
                self._state = data.get('state', {})
                self._started_at = data.get('started_at')
                return self._state
            except (json.JSONDecodeError, IOError) as e:
                print(f"[Checkpoint] warning: cannot read {self.state_file}: {e}")
                return {}
        return {}

    def get(self, key: str, default: Any = None) -> Any:
        """Get a value from the checkpoint state."""
        if not self._state:
            self.load()
        return self._state.get(key, default)

    def update(self, **kwargs) -> None:
        """Update state; triggers auto-save when interval/time threshold hit."""
        self._state.update(kwargs)
        self._update_count += 1

        now = time.time()
        should_save = (
            self._update_count >= self.auto_save_interval or
            (now - self._last_save_time) >= self.auto_save_seconds
        )
        if should_save:
            self._save()

    def _save(self) -> None:
        """Persist current state to disk atomically."""
        if self._started_at is None:
            self._started_at = datetime.now(timezone.utc).isoformat()

        data = {
            'task_name': self.task_name,
            'state': self._state,
            'started_at': self._started_at,
            'updated_at': datetime.now(timezone.utc).isoformat(),
            'status': 'in_progress',
        }

        tmp_file = self.state_file.with_suffix('.tmp')
        tmp_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        tmp_file.replace(self.state_file)

        self._update_count = 0
        self._last_save_time = time.time()

    def save(self) -> None:
        """Force-save current state."""
        self._save()

    def complete(self) -> None:
        """Mark task as completed."""
        self._state['completed'] = True

        if self._started_at is None:
            self._started_at = datetime.now(timezone.utc).isoformat()

        data = {
            'task_name': self.task_name,
            'state': self._state,
            'started_at': self._started_at,
            'completed_at': datetime.now(timezone.utc).isoformat(),
            'status': 'completed',
        }

        tmp_file = self.state_file.with_suffix('.tmp')
        tmp_file.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding='utf-8')
        tmp_file.replace(self.state_file)

    def clear(self) -> None:
        """Remove checkpoint file and reset in-memory state."""
        if self.state_file.exists():
            self.state_file.unlink()
        self._state = {}
        self._update_count = 0
        self._started_at = None

    def is_completed(self) -> bool:
        """Return True if the checkpoint is marked completed."""
        if not self.state_file.exists():
            return False
        try:
            data = json.loads(self.state_file.read_text(encoding='utf-8'))
            return data.get('status') == 'completed'
        except Exception:
            return False

    def __enter__(self):
        self.load()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        # Save on both clean and abnormal exits so we can resume later.
        self._save()
        return False


def get_checkpoint_status(state_dir: Path = DEFAULT_STATE_DIR) -> list[dict]:
    """Return status of every checkpoint under state_dir."""
    results = []
    if not state_dir.exists():
        return results

    for f in state_dir.glob('*_checkpoint.json'):
        try:
            data = json.loads(f.read_text(encoding='utf-8'))
            results.append({
                'task_name': data.get('task_name', f.stem),
                'status': data.get('status', 'unknown'),
                'started_at': data.get('started_at'),
                'updated_at': data.get('updated_at'),
                'completed_at': data.get('completed_at'),
                'state': data.get('state', {}),
            })
        except Exception as e:
            results.append({
                'task_name': f.stem,
                'status': 'error',
                'error': str(e),
            })

    return results


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Checkpoint management CLI')
    parser.add_argument('--list', action='store_true', help='List all checkpoints')
    parser.add_argument('--clear', type=str, metavar='TASK', help='Clear checkpoint for TASK')
    args = parser.parse_args()

    if args.list:
        statuses = get_checkpoint_status()
        if not statuses:
            print("No checkpoint files found")
        else:
            for s in statuses:
                print(f"\ntask: {s['task_name']}")
                print(f"  status: {s['status']}")
                if s.get('updated_at'):
                    print(f"  updated_at: {s['updated_at']}")
                if s.get('state'):
                    for k, v in s['state'].items():
                        if k != 'completed':
                            print(f"  {k}: {v}")

    elif args.clear:
        ckpt = Checkpoint(args.clear)
        if ckpt.state_file.exists():
            ckpt.clear()
            print(f"cleared checkpoint: {args.clear}")
        else:
            print(f"checkpoint not found: {args.clear}")
