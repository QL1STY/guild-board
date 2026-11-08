"""guildboard-core.exe in the installed copy: the core the Electron shell starts, with its channel on standard input and output."""
import sys

from guildboard.__main__ import main

sys.exit(main())
