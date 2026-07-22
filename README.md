# Pi Setup

A portable Pi Coding Agent setup with 13 active packages, the scout and
reviewer subagents, and the bundled skills.

## Requirements

- Node.js 20 or newer with npm
- Internet access during installation

## Installation

### macOS / Linux

~~~sh
git clone https://github.com/ylli-crypto/Pi.git "$HOME/.pi/ylli-setup-source"
cd "$HOME/.pi/ylli-setup-source"
sh install.sh
~~~

### Windows PowerShell

~~~powershell
git clone https://github.com/ylli-crypto/Pi.git "$env:USERPROFILE\.pi\ylli-setup-source"
Set-Location "$env:USERPROFILE\.pi\ylli-setup-source"
powershell -ExecutionPolicy Bypass -File .\install.ps1
~~~

The installer checks Node.js, installs Pi globally, installs the dependencies
for all 13 packages, and verifies the global pi command. It installs this
setup in ~/.pi/agent/ylli-setup and replaces ~/.pi/agent/settings.json with
this setup's global configuration.

After it completes, open a new terminal and run:

~~~sh
pi
~~~

Pi can then be started from any directory.

## Update

Run the same installer again:

~~~sh
cd "$HOME/.pi/ylli-setup-source"
git pull
sh install.sh
~~~
