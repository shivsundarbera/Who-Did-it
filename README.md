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
7. **Help call:** the police can tap "Help! Ask everyone for advice". A timer starts for everyone to see (the host sets its length in the lobby, 30 seconds to 5 minutes). While it runs, every living player except the police can type short messages to the police, up to 5 each, and killers can send messages too. Only the police can read the messages, and nobody learns who the police are. If the police do not catch the killer before time runs out, the killers win. Only one help call per round.

## Friends on different networks

Your computer needs a public address. Two common ways:

- A tunnel while you play: run `node server.js`, then in another terminal run a tunnel tool such as `ngrok http 3000`. Open the public address it prints, create the lobby from there, and share that link.
- Deploy this folder to any host that runs Node.js (for example Render or Railway). It needs only `node server.js`, and it reads the `PORT` environment variable.

## Notes

- Lobbies live in the server's memory. If you stop or restart the server, lobbies are gone.
- Roles stay on the server until the round ends, so players cannot read each other's roles by inspecting the page.
- Idle lobbies are removed after 6 hours.

## Look and feel

Cartoon characters (killer, police, citizen and a ghost for players who are out), a small face for every player, and short animations: the role card flips over when revealed, new deaths shake onto the screen, the help timer pulses in its last 10 seconds, and the winners get confetti. Animations switch off automatically for people who turned on "reduce motion" on their device. All artwork is drawn in the page itself, so there are no image files to host.

## In the app

- The start page and every lobby have a **How to play** button that explains the roles, a round and who wins.
- When a citizen taps "I am dead", everyone except that citizen sees a short cartoon scene: a citizen and a killer walk in, the killer stabs the citizen with a cartoon knife, and a ghost floats away. It uses generic characters, so it never shows who the real killer is. It is skipped for people who have "reduce motion" turned on.
- When the police make their guess, everyone sees a short scene. Right guess: the police run in, the killer shakes, handcuffs drop on them and stars spin. Wrong guess: the police point at an innocent player ("Who, me?"), a big red X lands, and the real killer peeks in laughing "Ha ha, wrong!".
- **Killer taunts:** every 30 to 40 seconds the killer cartoon pops up on the police player's screen with a teasing line (Bengali, Hindi and English mixed). It shows only while the police have their role revealed, and the police can switch it off with "Turn killer taunts off". The lines are the `TAUNTS` list near the top of the script in `index.html`, so you can change them. The popup is the same cartoon for everyone, so it never reveals who the real killer is.
