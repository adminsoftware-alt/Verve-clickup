// The Spaces tab on a phone: the sidebar's Space › Folder › List tree, full screen.
//
// It is the same component as the desktop sidebar, so what each person sees -- and the + to add
// a List or Folder where they may -- follows the same rules in both places. On a wider screen
// the tree is already down the side, so this page sends you home.
import React from 'react';
import { Navigate } from 'react-router-dom';

import { usePhone } from './useBreakpoint';
import { SpacesSidebar } from './SpacesSidebar';
import { FavoritesNav } from './Favorites';

export const SpacesPage: React.FC = () => {
  const phone = usePhone();
  if (!phone) return <Navigate to="/" replace />;
  return (
    <div className="app-sidebar -m-4 min-h-[calc(100%+2rem)] pb-6 text-[15px]">
      <h1 className="px-4 pb-2 pt-4 text-lg font-semibold text-gray-900">Spaces</h1>
      <div className="space-y-3 px-2">
        <FavoritesNav />
        <SpacesSidebar />
      </div>
    </div>
  );
};
