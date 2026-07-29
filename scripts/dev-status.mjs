import net from 'node:net';
import os from 'node:os';

function isOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(800);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    const close = () => {
      socket.destroy();
      resolve(false);
    };
    socket.once('error', close);
    socket.once('timeout', close);
  });
}

const services = [
  ['MySQL', 3306],
  ['Backend', 8080],
  ['Frontend', 5173],
];

for (const [name, port] of services) {
  console.log(`${name.padEnd(8)} ${(await isOpen(port)) ? 'ready' : 'stopped'}  127.0.0.1:${port}`);
}

const addresses = Object.values(os.networkInterfaces())
  .flat()
  .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
  .map((entry) => entry.address);

if (addresses.length > 0) {
  console.log('\nLAN frontend URLs:');
  for (const address of [...new Set(addresses)]) console.log(`- http://${address}:5173/`);
}
