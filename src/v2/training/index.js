// RPG Battle v2, training (contract §3 skill.train, §5 "Training start"). This package is the clock arithmetic
// only: days and minutes, the sixty-minute window, and the credits a finished session gives under the shared
// day caps. The sessions, the fee, the interruption roll and the UI are later work.

export { dayOf, dayStart, midnightsBetween, minuteOfDay, readClock, trainingWindow } from './clock.js';
export { completionCredits } from './credits.js';
