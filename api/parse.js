import parseTorrent from 'parse-torrent';
import Client from 'bittorrent-tracker';

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', (err) => reject(err));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const buffer = await getRawBody(req);
    
    if (!buffer || buffer.length === 0) {
      return res.status(400).json({ error: 'Empty file payload' });
    }

    const parsed = await parseTorrent(buffer);

    if (!parsed || !parsed.infoHash) {
      return res.status(400).json({ error: 'Invalid torrent file: Missing infoHash' });
    }

    const announceUrls = Array.isArray(parsed.announce) ? parsed.announce : (parsed.announce ? [parsed.announce] : []);
    const httpTrackers = announceUrls.filter(url => typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://')));

    if (httpTrackers.length === 0) {
      return res.status(200).json({
        name: parsed.name || 'Unknown Torrent',
        infoHash: parsed.infoHash,
        peers: [],
        message: 'No HTTP/HTTPS trackers found in this torrent (UDP trackers are unsupported on Serverless).'
      });
    }

    const peersList = [];

    await new Promise((resolve) => {
      const client = new Client({
        infoHash: parsed.infoHash,
        announce: httpTrackers,
        peerId: Buffer.from('-VT1000-' + Math.random().toString(36).substring(2, 14)),
        port: 6881
      });

      client.on('peer', (peer) => {
        peersList.push({ ip: peer.ip, port: peer.port });
      });

      client.on('error', (err) => {
        console.error('Tracker error:', err.message);
      });

      client.start();

      setTimeout(() => {
        try { client.destroy(); } catch (e) {}
        resolve();
      }, 4500);
    });

    const uniquePeers = Array.from(new Set(peersList.map(p => `${p.ip}:${p.port}`)))
      .map(str => {
        const [ip, port] = str.split(':');
        return { ip, port };
      });

    return res.status(200).json({
      name: parsed.name || 'Unknown Torrent',
      infoHash: parsed.infoHash,
      length: parsed.length || 0,
      trackersQueried: httpTrackers,
      peers: uniquePeers
    });

  } catch (err) {
    console.error('Parsing error details:', err);
    return res.status(500).json({ error: 'Failed to process torrent file', details: err.message });
  }
}

export const config = {
  api: { bodyParser: false }
};