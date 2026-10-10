import { useEffect } from 'preact/hooks';
import { startCustomTour, tour, type TourStep } from '../../coach/tour';
import { settings } from '../../state/store';

const TOUR_3D: TourStep[] = [
  {
    title: 'Welcome to Kinora 3D! 👋',
    body: 'In two minutes you’ll make, color and animate your first 3D object. You can stop the tour any time.',
    next: 'Let’s go',
  },
  {
    target: '[data-coach="viewport3d"]',
    title: 'Look around',
    body: 'Drag to turn around your scene. Two fingers or right-drag slides it, pinch or scroll zooms. You can’t break anything.',
    next: 'Got it',
  },
  {
    target: '[data-coach="add3d"]',
    title: 'Add a shape',
    body: 'Tap Add and pick any shape — a sphere, a donut, a cylinder… It appears in the middle of your view.',
    until: '3d:added',
    next: 'Skip',
  },
  {
    target: '[data-coach="viewport3d"]',
    title: 'Move it',
    body: 'Drag one of the colored arrows. Red moves it left/right, green up/down, blue towards you. The squares move it on a flat plane.',
    until: '3d:transformed',
    next: 'Skip',
  },
  {
    target: '[data-coach="tab-material"], [data-coach="looks3d"]',
    title: 'Give it a look',
    body: 'Open Looks and tap Gold, Glass, Neon or any other material. Real light and reflections, instantly.',
    until: '3d:material',
    next: 'Skip',
  },
  {
    target: '[data-coach="mode3d"], [data-coach="viewport3d"]',
    title: 'Change its shape',
    body: 'Switch to “Edit shape” (or press Tab). Click a face, then “Pull out” — that’s extruding, how most 3D models are built.',
    until: '3d:edited',
    next: 'Skip',
  },
  {
    target: '[data-coach="tab-animate"], [data-coach="timeline3d"]',
    title: 'Make it move',
    body: 'In Animate, tap Bounce or Spin. It creates keyframes — moments the object remembers. Then press play ▶.',
    until: '3d:keyed',
    next: 'Skip',
  },
  {
    target: '[data-coach="export3d"]',
    title: 'Show it off 🎉',
    body: 'Export a picture, a video, or a 3D file for games (GLB), 3D printing (STL) or AR on iPhone (USDZ).',
    next: 'Finish',
  },
];

export function startTour3d(): void {
  startCustomTour(TOUR_3D, 'tour3dDone');
}

/** Starts the 3D tour the first time someone opens the studio. */
export function Coach3D() {
  useEffect(() => {
    if (settings.peek().tour3dDone) return;
    const t = setTimeout(() => {
      if (!tour.peek() && !settings.peek().tour3dDone) startTour3d();
    }, 900);
    return () => clearTimeout(t);
  }, []);
  return null;
}
