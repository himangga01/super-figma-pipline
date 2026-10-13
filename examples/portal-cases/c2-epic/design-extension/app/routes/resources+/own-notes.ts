import { redirect } from 'react-router';
import { requireUserId } from '#app/utils/auth.server.ts';
import { prisma } from '#app/utils/db.server.ts';

/** Existing session validation and Prisma owner identity select the safe post-login notes route. */
export async function loader({ request }: { request: Request }) {
  const userId = await requireUserId(request);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } });
  if (!user) throw new Response('User not found', { status: 404 });
  return redirect('/users/' + encodeURIComponent(user.username) + '/notes');
}
