#!/bin/bash
set -euo pipefail

cleanup_cache_dir() {
  local cache_dir="$1"
  local models_dir="$cache_dir/models"

  if [ -d "$models_dir" ]; then
    rm -rf "$models_dir"
    echo "Removed Mouthpiece cached models in $cache_dir"
  fi

  if [ -d "$cache_dir" ]; then
    rmdir "$cache_dir" 2>/dev/null || true
  fi
}

cleanup_cache_dir "$HOME/.cache/mouthpiece"
cleanup_cache_dir "$HOME/.cache/openwhispr"
