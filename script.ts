import { spawn } from "https://deno.land/std@0.129.0/node/child_process.ts";
import PQueue from "https://deno.land/x/p_queue@1.0.1/mod.ts";

const queue = new PQueue({
  concurrency: 5,
});

// Get playlist spotify:url

const [playlistUrl] = Deno.args;

const tokenReq = await fetch("https://spotifycodes.com/getToken.php");
const token = (await tokenReq.json()).access_token;
console.log(token);

// Get tracks

const playlistInfoReq = await fetch(
  `https://api.spotify.com/v1/users/spotify/playlists/${playlistUrl
    .split(":")
    .at(-1)}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);
const playlistInfoJson = await playlistInfoReq.json();

const tracks: [{ name: string; uri: string }] =
  playlistInfoJson?.tracks?.items?.map(
    (item: {
      track: { artists: [{ name: string }]; name: string; uri: string };
    }) => ({
      name: `${item.track.name} - ${item.track.artists
        .map(({ name }) => name)
        .join(",")}`,
      uri: item.track.uri,
    })
  );

try {
  await Deno.mkdir("stl");
} catch (_e) {
  // Do nothing, hope the best
}
try {
  await Deno.mkdir("svg");
} catch (_e) {
  // Do nothing, hope the best
}

// Get svg spotifycode for each track
await (async () => {
  for (const track of tracks.slice(0, 20)) {
    const { name: songName, uri: songUri } = track;
    const svgReq = await fetch(
      `https://scannables.scdn.co/uri/plain/svg/000000/white/640/${songUri}`
    );
    const svgText = await svgReq.text();
    console.log(songUri);
    // Process the svg, removing second line
    const processedSVG = svgText
      .split("\n")
      .filter((_line, lineN) => lineN !== 1)
      .join("\n");
    const svgPath = `./svg/${songUri.split(":").at(-1)}.svg`;
    await Deno.writeTextFile(svgPath, processedSVG);
    // Execute openscad and get an stl
    queue.add(
      () =>
        new Promise((resolve) => {
          spawn(`/usr/local/bin/openscad`, [
            "./spcode.scad",
            "-o",
            `./stl/${songName}.stl`,
            "-D",
            `svgPath="${svgPath}"`,
          ]).on("close", resolve);
        })
    );
  }
  await queue.onIdle();
})();
