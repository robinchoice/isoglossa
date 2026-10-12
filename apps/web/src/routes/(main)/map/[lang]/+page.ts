import { LANGS, type Lang } from '@app/shared';
import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = ({ params }) => {
  if (!LANGS.includes(params.lang as Lang)) error(404);
  return { lang: params.lang as Lang };
};
