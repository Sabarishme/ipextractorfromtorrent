import parseTorrent from 'parse-torrent';
import Client from 'bittorrent-tracker';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const buffer = Buffer.from(req.body);
    const parsed = await parseTorrent(buffer);

    if (!parsed.infoHash) {
      return res.status(400).json({ error: 'Invalid torrent file: Missing infoHash' });
    }

    const httpTrackers = (parsed.announce || []).filter(url => url.startsWith('http://') || url.startsWith('https://'));

    if (httpTrackers.length === 0) {
      return res.status(200).json({
        name: parsed.name,
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
        client.destroy();
        resolve();
      }, 4500);
    });

    const uniquePeers = Array.from(new Set(peersList.map(p => `${p.ip}:${p.port}`)))
      .map(str => {
        const [ip, port] = str.split(':');
        return { ip, port };
      });

    return res.status(200).json({
      name: parsed.name,
      infoHash: parsed.infoHash,
      length: parsed.length,
      trackersQueried: httpTrackers,
      peers: uniquePeers
    });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to process torrent file', details: err.message });
  }
}

export const config = {
  api: { bodyParser: false }
};