#!/usr/bin/env bash
# Install Audiveris (OMR engine) + Java 17 on Debian/Ubuntu (x86_64).
set -euo pipefail
VERSION="${AUDIVERIS_VERSION:-5.11.0}"
UBUNTU="$(. /etc/os-release && echo "${VERSION_ID}")"
DEB="Audiveris-${VERSION}-ubuntu${UBUNTU}-x86_64.deb"
URL="https://github.com/Audiveris/audiveris/releases/download/${VERSION}/${DEB}"
tmp="$(mktemp -d)"
curl -fsSL -o "${tmp}/${DEB}" "${URL}"
sudo apt-get update
sudo apt-get install -y openjdk-17-jre-headless "${tmp}/${DEB}"
rm -rf "${tmp}"
echo "Audiveris installed: $(command -v Audiveris || echo /opt/audiveris/bin/Audiveris)"
