import { useOptionalUser } from '#app/utils/user.ts';
import { legacyLandingRoutes } from '#app/components/cdd/LegacyLandingActions.tsx';
import CurrentLegacyDesign from '#app/components/cdd/CurrentLegacyDesign.tsx';
import type { Route } from './+types/index.ts';

export const handle = { cddLanding: true };
export const meta: Route.MetaFunction = () => [{ title: 'Workspace | Epic Notes' }];
export default function Index() {
  const user = useOptionalUser();
  return <CurrentLegacyDesign routes={legacyLandingRoutes(user?.username ?? null)} />;
}
