# Pi Setup

Installs Pi globally with the 13 active packages, the scout and reviewer
subagents, and the bundled skills. It works whether Pi is already installed or
not.

macOS / Linux — clone and install directly inside your user Pi directory:

~~~bash
git clone https://github.com/ylli-crypto/Pi.git "$HOME/.pi/ylli-setup-source"
node "$HOME/.pi/ylli-setup-source/install.mjs" --replace
~~~

Windows PowerShell:

~~~powershell
git clone https://github.com/ylli-crypto/Pi.git "$env:USERPROFILE\.pi\ylli-setup-source"
node "$env:USERPROFILE\.pi\ylli-setup-source\install.mjs" --replace
~~~

The installer puts the active setup in ~/.pi/agent/ylli-setup, configures Pi
with absolute paths, installs Pi globally, and verifies that pi can be called
from any directory. Wait for Pi is installed globally before starting it.
Node.js 20 or newer with npm is required.

Then open a new terminal and run pi from any directory.
