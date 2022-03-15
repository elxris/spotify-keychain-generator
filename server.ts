import { serve } from "https://deno.land/std@0.129.0/http/server.ts";
import { spawn } from "https://deno.land/std@0.129.0/node/child_process.ts";
import TTL from "https://deno.land/x/ttl@1.0.1/mod.ts";
import PQueue from "https://deno.land/x/p_queue@1.0.1/mod.ts";

const stlQueue = new PQueue({
  concurrency: 1,
});

const svgQueue = new PQueue({
  concurrency: 1,
});

const playlistQueue = new PQueue({
  concurrency: 1,
});

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

let spotifyToken: Promise<string>;

const getNewToken = () => {
  spotifyToken = (async () => {
    const tokenReq = await fetch("https://spotifycodes.com/getToken.php");
    const token = (await tokenReq.json()).access_token;
    console.debug("new token", token);
    return token;
  })();

  return spotifyToken;
};

await getNewToken();

export async function exists(filePath: string): Promise<boolean> {
  try {
    await Deno.lstat(filePath);
    return true;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return false;
    }
    throw err;
  }
}

const existsSVG = async (songUri: string) => {
  if (await exists(`./svg/${songUri}.svg`)) {
    console.debug(`svg ${songUri} exists, skipping`);
    return true;
  } else return false;
};

const downloadSVG = async (songUri: string) => {
  if(await existsSVG(songUri)) return;

  const svgReq = await fetch(
    `https://scannables.scdn.co/uri/plain/svg/000000/white/640/spotify:track:${songUri}`
  );

  const svgText = await svgReq.text();
  console.debug(`svg ${songUri} downloaded`);

  // Make sure an svg is what we got
  if (svgText.split("\n").at(-1) !== "</svg>") {
    throw new Error("SVG is malformed");
  }
  // Process the svg, removing second line
  const processedSVG = svgText
    .split("\n")
    .filter((_line, lineN) => lineN !== 1)
    .join("\n");
  const svgPath = `./svg/${songUri}.svg`;
  await Deno.writeTextFile(svgPath, processedSVG);
  console.debug(`svg ${songUri} saved`);
};

const existsSTL = async (songUri: string) => {
  if (await exists(`./stl/${songUri}.stl`)) {
    console.debug(`stl ${songUri} exists, skipping`);
    return true;
  } else return false;
}

const generateSTL = async (songUri: string) => {
  if (await existsSTL(songUri)) return;

  const svgPath = `./svg/${songUri}.svg`;
  console.debug(`stl ${songUri} calling openscad`);
  await new Promise((resolve) => {
    spawn(`/usr/local/bin/openscad`, [
      "./spcode.scad",
      "-o",
      `./stl/${songUri}.stl`,
      "-D",
      `svgPath="${svgPath}"`,
    ]).on("close", resolve);
  });
  console.debug(`stl ${songUri} generated`);
};

const playlistCache = new TTL<{
  tracks: [{ name: string; uri: string }];
  name: string;
}>(60_000);

const getPlaylistInfo = async (playlistUri: string) => {
  const info = playlistCache.get(playlistUri);
  if (info) {
    console.debug(`playlist ${playlistUri} cache hit`);
    return info;
  }

  // Get playlist info
  const playlistInfoReq = await fetch(
    `https://api.spotify.com/v1/users/spotify/playlists/${playlistUri}`,
    {
      headers: {
        Authorization: `Bearer ${await spotifyToken}`,
      },
    }
  );
  const playlistInfoJson = await playlistInfoReq.json();

  if (playlistInfoJson?.error?.status === 401) {
    getNewToken();
    throw playlistInfoJson.error;
  }

  console.debug(`playlist ${playlistUri} parsing`);

  const tracks: [{ name: string; uri: string }] =
    playlistInfoJson?.tracks?.items?.map(
      (item: {
        track: { artists: [{ name: string }]; name: string; uri: string };
      }) => ({
        name: `${item.track.name} - ${item.track.artists
          .map(({ name }) => name)
          .join(",")}`,
        uri: item.track.uri.split(":").at(-1),
      })
    );
  if (!tracks) throw new Error("No tracks found");

  const playlistInfo = {
    tracks,
    name: playlistInfoJson.name,
  };
  playlistCache.set(playlistUri, playlistInfo);
  console.debug(`playlist ${playlistUri} parsed and cached`);

  return playlistInfo;
};

const handler = async (req: Request) => {
  try {
    const { playlistUri, start = 0, end = 3 } = await req?.json();

    if (start < 0 || end < 0 || end - start > 3)
      throw new Error("limits abuse");

    console.debug('new request', playlistUri);

    const { tracks, name } = await playlistQueue.add(() =>
      getPlaylistInfo(playlistUri)
    );

    // Get svg spotifycode for each track
    for (const track of tracks.slice(start, end)) {
      const { uri: songUri } = track;

      if (await existsSVG(songUri)) continue;

      await svgQueue.add(() => downloadSVG(songUri));
    }

    for (const track of tracks.slice(start, end)) {
      const { uri: songUri } = track;

      if (await existsSTL(songUri)) continue;

      // Execute openscad and get an stl
      await stlQueue.add(() => generateSTL(songUri));
    }

    return new Response(
      JSON.stringify({
        status: "ok",
        data: { name, tracks: tracks.slice(start, end) },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      }
    );
  } catch (e) {
    console.warn(e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: e.status || 400,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    });
  }
};

serve(handler);
