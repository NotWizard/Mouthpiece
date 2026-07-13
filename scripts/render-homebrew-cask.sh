#!/bin/bash
set -euo pipefail

VERSION=$1
ARM_SHA=$2
INTEL_SHA=$3
OUTPUT=$4
REPOSITORY=${GITHUB_REPOSITORY:-NotWizard/Mouthpiece}

cat > "$OUTPUT" <<CASK
cask "mouthpiece" do
  on_arm do
    version "$VERSION"
    sha256 "$ARM_SHA"

    url "https://github.com/$REPOSITORY/releases/download/v#{version}/Mouthpiece-#{version}-arm64.dmg"
  end

  on_intel do
    version "$VERSION"
    sha256 "$INTEL_SHA"

    url "https://github.com/$REPOSITORY/releases/download/v#{version}/Mouthpiece-#{version}-x64.dmg"
  end

  name "Mouthpiece"
  desc "Native speech-to-text dictation app"
  homepage "https://github.com/$REPOSITORY"

  depends_on macos: ">= :sequoia"

  livecheck do
    url :url
    strategy :github_latest
  end

  app "Mouthpiece.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/Mouthpiece.app"],
                   sudo: false
  end

  zap trash: [
    "~/.cache/mouthpiece",
    "~/Library/Application Support/Mouthpiece",
    "~/Library/Preferences/com.mouthpiece.app.plist",
  ]
end
CASK
