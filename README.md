# Pi Setup

Installs Pi globally with the 13 active packages, the scout and reviewer
subagents, and the bundled skills.

~~~bash
git clone https://github.com/ylli-crypto/Pi.git
cd Pi
./install.sh --replace
~~~

The installer copies the setup to ~/.pi/agent/ylli-setup and configures Pi with
absolute paths. The cloned folder is not needed after installation.

Start Pi from any directory:

~~~bash
pi
~~~
