# Pi Setup

Installs Pi globally with the 13 active packages, the scout and reviewer
subagents, and the bundled skills. It works whether Pi is already installed or
not.

~~~bash
git clone https://github.com/ylli-crypto/Pi.git
cd Pi
node install.mjs --replace
~~~

The installer copies the setup to ~/.pi/agent/ylli-setup and configures Pi with
absolute paths. It installs Pi 0.81.1 when necessary, or updates an existing Pi
installation to that version. Node.js 20 or newer with npm is required. The
cloned folder is not needed after installation.

Start Pi from any directory:

~~~bash
pi
~~~
