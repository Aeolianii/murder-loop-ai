import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { shouldShowMobileSidebarToggle, shouldShowStartMenu } from './App';
import { Header } from './components/Header';
import { INITIAL_STATE } from './constants';

assert.equal(shouldShowStartMenu(INITIAL_STATE), true);
assert.equal(shouldShowStartMenu({ ...INITIAL_STATE, phase: 'investigating' }), false);
assert.equal(shouldShowStartMenu({ ...INITIAL_STATE, ending: 'death' }), false);

assert.equal(shouldShowMobileSidebarToggle(false, false, false), true);
assert.equal(shouldShowMobileSidebarToggle(true, false, false), false);
assert.equal(shouldShowMobileSidebarToggle(false, true, false), false);
assert.equal(shouldShowMobileSidebarToggle(false, false, true), false);

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: () => null,
    setItem: () => undefined,
  },
});

const headerHtml = renderToStaticMarkup(
  <Header time="23:00" location="青荷公寓" onRestart={() => undefined} />,
);
assert.match(headerHtml, /lucide-house/);
assert.match(headerHtml, /返回主界面/);
assert.doesNotMatch(headerHtml, /lucide-rotate-ccw/);
