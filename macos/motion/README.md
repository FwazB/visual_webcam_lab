# Body Synth Motion

Open [Body Synth](https://body-synth-beta.vercel.app/) on your Mac and click
**Start AirPods**. The website opens this companion and connects to it over
loopback. Keep your AirPods connected to the Mac and hold your usual playing
posture while tracking starts. The AirPods panel shows the live tilt and has
controls to set the center or stop.

## Install on another Mac

1. Use a Mac running macOS 14 or later with Apple’s Command Line Tools
   installed. Download and extract the Body Synth repository, or use an
   existing checkout.
2. In Finder, open `macos/motion` in that folder and double-click
   **Install Body Synth Motion.command**. It builds the companion on this Mac,
   installs it in your user Applications folder and registers its website link.
3. Return to the website and click **Start AirPods**. If your browser asks to
   open **Body Synth Motion** or access a local device, allow it. Grant motion
   access when macOS asks.

The companion opens when requested and exits after the session is idle.
Run the installer again to update the local copy. To remove it, stop tracking,
wait for the companion to exit, and move `~/Applications/Body Synth Motion.app`
to the Trash.
