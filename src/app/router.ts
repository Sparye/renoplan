import { useEffect, useState } from 'react';

export type Route = { page: 'home' } | { page: 'project'; id: string };

function parse(hash: string): Route {
  const m = hash.match(/^#\/p\/([\w-]+)$/);
  return m ? { page: 'project', id: m[1]! } : { page: 'home' };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setRoute(parse(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (route: Route) => {
  location.hash = route.page === 'home' ? '#/' : `#/p/${route.id}`;
};
