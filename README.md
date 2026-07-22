# Pi Setup

Project-local Pi Coding Agent setup with 13 active packages, custom agents,
skills, and configuration.

## Requirements

- Node.js 20 or newer
- npm

## Installation

~~~bash
npm install --global @earendil-works/pi-coding-agent@0.81.1
git clone https://github.com/ylli-crypto/Pi.git
cd Pi

for package in packages/active/*; do
  [ -f "$package/package-lock.json" ] && (cd "$package" && npm ci --omit=dev --no-audit --no-fund)
done

pi --approve
~~~

Start Pi from the cloned repository:

~~~bash
cd Pi
pi
~~~

Pi reads .pi/settings.json and loads the packages in packages/active.
