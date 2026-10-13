import { ago } from './helpers';

/**
 * Demo team. Passwords exist ONLY for the isolated demo auth service and are
 * documented in the README. Real authentication will be handled by the backend.
 */
export const DEMO_PASSWORD = 'studioflow';

export function seedUsers() {
  return [
    {
      id: 'u_amelia',
      name: 'Amelia Hart',
      email: 'amelia@studioflow.demo',
      role: 'Creative Director',
      avatarColor: '#6257E8',
      status: 'active',
      lastActiveAt: ago(0, 0, 4),
      createdAt: ago(210),
    },
    {
      id: 'u_jordan',
      name: 'Jordan Reyes',
      email: 'jordan@studioflow.demo',
      role: 'Senior Copywriter',
      avatarColor: '#0E7490',
      status: 'active',
      lastActiveAt: ago(0, 2, 15),
      createdAt: ago(205),
    },
    {
      id: 'u_sam',
      name: 'Sam Okafor',
      email: 'sam@studioflow.demo',
      role: 'Designer & Production',
      avatarColor: '#C2410C',
      status: 'active',
      lastActiveAt: ago(1, 3),
      createdAt: ago(190),
    },
  ];
}
