/* @flow */

import { Module } from '../core/module';
import { Thing, watchForThings, hide } from '../utils';

export const module: Module<*> = new Module('autoHide');

module.moduleName = 'autoHideName';
module.category = 'browsingCategory';
module.description = 'autoHideDesc';
module.disabledByDefault = true;

const VISIBLE_MIN = 2000;

module.beforeLoad = () => {
	const seen: Set<Thing> = new Set();
	const pending: Map<Thing, number> = new Map();

	const io = new IntersectionObserver(entries => {
		const now = Date.now();

		for (const { target, isIntersecting } of entries) {
			const thing = Thing.checkedFrom(target);
			if (isIntersecting) pending.set(thing, now);
			else pending.delete(thing);
		}

		setTimeout(() => { flush(now + VISIBLE_MIN); });
	}, { threshold: [1] });

	watchForThings(['post'], thing => {
		io.observe(thing.entry);
	});

	function flush(before: number) {
		for (const [thing, added] of pending.entries()) {
			if (before > added) {
				hide(thing);
				io.unobserve(thing.entry);
				seen.add(thing);
				pending.delete(thing);
			}
		}
	}

	window.addEventListener('onbeforeunload', () => { flush(Infinity); });
};
