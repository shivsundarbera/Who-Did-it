# Who Did It

A killer / police / citizen party game. The host creates a lobby, shares the link, and every friend joins from their own phone.

## Run it

1. Install Node.js 18 or newer from https://nodejs.org
2. Open a terminal in this folder and run:

       node server.js

3. The terminal prints two addresses:
   - `http://localhost:3000` works only on your computer.
   - `http://192.168.x.x:3000` (your real number will differ) works for anyone on the same Wi-Fi.

There is nothing to install with npm. To use a different port: `PORT=4000 node server.js` (on Windows PowerShell: `$env:PORT=4000; node server.js`).

## Play

1. Open the **same Wi-Fi address** in your browser, not `localhost`. The lobby link is built from the address you opened, so this is what makes it work on your friends' phones.
2. Tap **Create lobby**. You are the host.
3. Type your name and tap **Join game** if you want to play too.
4. Send the lobby link to your friends (Copy or Share link). They open it, type a name and join.
5. Set players wanted, killers and police, then tap **Start game**.
6. Everyone taps to reveal their own role.
   - Citizen: one button, "I am dead". Everyone sees who died.
   - Police: a button for every player. One guess. Right guess means police and citizens win, wrong means killers win.
   - Killer: no buttons.

## Friends on different networks

Your computer needs a public address. Two common ways:

- A tunnel while you play: run `node server.js`, then in another terminal run a tunnel tool such as `ngrok http 3000`. Open the public address it prints, create the lobby from there, and share that link.
- Deploy this folder to any host that runs Node.js (for example Render or Railway). It needs only `node server.js`, and it reads the `PORT` environment variable.

## Notes

- Lobbies live in the server's memory. If you stop or restart the server, lobbies are gone.
- Roles stay on the server until the round ends, so players cannot read each other's roles by inspecting the page.
- Idle lobbies are removed after 6 hours.
