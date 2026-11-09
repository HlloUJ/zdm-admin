import { taskMavenVolume } from '../task-maven.mjs';
export function backendFixture() {
  const expected = { root: '/task', project: 'zdm-task-test', backendPort: 8084, migrationDirectory: '/migrations' };
  const container = {
    Id: 'container-1',
    Image: 'sha256:image',
    State: { Running: true, StartedAt: 'start-1' },
    Config: {
      Labels: {
        'com.docker.compose.project': expected.project,
        'com.docker.compose.service': 'backend',
        'com.zdm.task.preview': 'true',
        'com.zdm.task.database': 'integration',
      },
    },
    HostConfig: { PortBindings: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: '8084' }] } },
    Mounts: [
      { Type: 'bind', Source: '/task', Destination: '/workspace', RW: true },
      { Type: 'bind', Source: '/migrations', Destination: '/task-migrations', RW: false },
      { Type: 'volume', Destination: '/root/.m2', Name: taskMavenVolume('/task', 'zdm-task-test'), RW: true },
    ],
  };
  return { expected, container };
}
