# Pi Setup

A portable Pi Coding Agent setup with 13 active packages, the scout and
reviewer subagents, and the bundled skills.

## Requirements

- Node.js 20 or newer with npm
- Internet access during installation

## Installation

### macOS / Linux

~~~sh
git clone https://github.com/ylli-crypto/Pi.git
cd Pi
sh install.sh
~~~

### Windows PowerShell

~~~powershell
git clone https://github.com/ylli-crypto/Pi.git
Set-Location Pi
powershell -ExecutionPolicy Bypass -File .\install.ps1
~~~

The cloned Pi folder is the installation folder. The installer shows a
confirmation first. Choose No to abort without changing anything. Choose Yes
to delete the existing global Pi command and all previous Pi data in ~/.pi,
then install a clean Pi and this setup only.

Pi is added through npm's global command path, so pi can be started from any
directory. The 13 package sources remain in the cloned Pi folder. Do not move
or delete that folder after installation.

After it completes, open a new terminal and run:

~~~sh
pi
~~~

Pi can then be started from any directory.

## Update

Run the same installer again:

~~~sh
cd Pi
git pull
sh install.sh
~~~
