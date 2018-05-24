/* @flow */

import { sortBy, map, flow } from 'lodash/fp';
import { JSAPI_CONSUMER_NAME } from '../constants/jsapi';
import type {
	CommentAuthorEventData, // eslint-disable-line no-unused-vars
	PostAuthorEventData, // eslint-disable-line no-unused-vars
	PostEventData, // eslint-disable-line no-unused-vars
	SubredditEventData, // eslint-disable-line no-unused-vars
	UserHovercardEventData, // eslint-disable-line no-unused-vars
} from '../types/events';
import { Thing, Post, Comment } from './Thing';
import { isAppType, isPageType } from './location';
import { forEachChunked } from './async';
import { waitForChild, watchForFutureChildren, getViewportSize } from './dom';

type WatcherOptions = {| immediate?: boolean |};

type ElementWatcherType = 'siteTable' | 'selfText' | 'newComments';
type ElementWatcherCallback = (e: any) => void | Promise<void>;

const elementWatchers: {
	[ElementWatcherType]: Array<{
		selector: ?string,
		callback: ElementWatcherCallback,
		options?: WatcherOptions,
	}>,
} = {
	siteTable: [],
	selfText: [],
	newComments: [],
};

type ThingWatcherType = 'comment' | 'message' | 'post' | 'subreddit';
type ThingWatcherCallback = (thing: Thing) => void | Promise<void>;

const thingWatchers: {
	[ThingWatcherType]: Array<{
		callback: ThingWatcherCallback,
		options?: WatcherOptions,
	}>,
} = {
	comment: [],
	message: [],
	post: [],
	subreddit: [],
};

function registerElement(type, element, sorter = callbacks => callbacks) {
	const elementCallbacks: Map<HTMLElement, Array<() => mixed>> = new Map();

	function addCallback(callback, actingOnElement, options) {
		if (options && options.immediate) {
			try { callback(); } catch (e) { console.error(e); }
		} else {
			const callbacks = elementCallbacks.get(actingOnElement);
			if (callbacks) callbacks.push(callback);
			else elementCallbacks.set(actingOnElement, [callback]);
		}
	}

	for (const thing of Thing.findThings(element)) {
		const thingWatcherCallbacks =
			thing instanceof Post && thingWatchers.post ||
			thing instanceof Comment && thingWatchers.comment ||
			//Thing.isMessage(thing.element) && thingWatchers.message ||
			//Thing.isSubreddit() && thingWatchers.subreddit ||
			[];

		for (const { callback, options } of thingWatcherCallbacks) {
			addCallback(() => callback(thing), thing.element, options);
		}
	}

	for (const { selector, callback, options } of elementWatchers[type]) {
		const elements = selector ? Array.from(element.querySelectorAll(selector)) : [element];
		for (const e of elements) {
			// Avoid excessive number of chunked callbacks by tying the callback to an existing Thing
			const closest = e.closest && (e.parentElement: any).closest('.thing') || e;
			addCallback(() => callback(e), closest, options);
		}
	}

	return flow(
		sorter,
		map(v => v[1]),
		forEachChunked(c => { for (const callback of c) try { callback(); } catch (e) { console.error(e); } })
	)(Array.from(elementCallbacks));
}

/* eslint-disable no-redeclare, no-unused-vars */
declare function watchForThings(type: 'post' | 'message' | 'subreddit', callback: (thing: Post) => void | Promise<void>, options?: WatcherOptions): void;
declare function watchForThings(type: 'comment', callback: (thing: Comment) => void | Promise<void>, options?: WatcherOptions): void;
declare function watchForThings(type: 'any', callback: (thing: Thing) => void | Promise<void>, options?: WatcherOptions): void;

export function watchForThings(type: ThingWatcherType | 'any', callback, options?: WatcherOptions) {
	if (type === 'any') {
		for (const v of ['comment', 'message', 'post', 'subreddit']) thingWatchers[v].push({ callback, options });
	} else {
		thingWatchers[type].push({ callback, options });
	}
}

export function watchForElements(types: Array<ElementWatcherType>, selector: ?string, callback: ElementWatcherCallback, options?: WatcherOptions) {
	for (const type of types) elementWatchers[type].push({ selector, callback, options });
}

const callbacks = {
	subreddit: [],
	postAuthor: [],
	post: [],
};

/* eslint-disable no-redeclare, no-unused-vars */
declare function watchForRedditEvents(type: 'subreddit', callback: (HTMLElement, SubredditEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'postAuthor', callback: (HTMLElement, PostAuthorEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'post', callback: (HTMLElement, PostEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'userHovercard', callback: (HTMLElement, UserHovercardEventData) => void | Promise<void>): void;
declare function watchForRedditEvents(type: 'commentAuthor', callback: (HTMLElement, CommentAuthorEventData) => void | Promise<void>): void;

export function watchForRedditEvents(type: $Keys<typeof callbacks>, callback) {
	if (!callbacks[type]) {
		callbacks[type] = [];
	}
	callbacks[type].push(callback);
}
/* eslint-enable no-redeclare */

function handleRedditEvent({ target, detail: { type, data } }) {
	const fns = callbacks[type];
	if (!fns) {
		if (process.env.NODE_ENV === 'development') {
			console.warn('Unhandled reddit event type:', type);
		}
		return;
	}

	let expandoId = `${type}|`;
	switch (type) {
		case 'postAuthor':
			expandoId += data.post.id;
			break;
		case 'commentAuthor':
			expandoId += data.comment.id;
			break;
		case 'userHovercard':
			expandoId += `${data.contextId}|${data.user.id}`;
			break;
		case 'subreddit':
		case 'post':
		default:
			expandoId += data.id;
			break;
	}

	const update = target.expando && target.expando._.id === expandoId ?
		(target.expando._.update || 0) + 1 :
		0;

	data._ = {
		id: expandoId,
		type,
		update,
	};
	target.expando = data;

	const ownedTarget = target.querySelector(`[data-name="${JSAPI_CONSUMER_NAME}"]`);
	for (const fn of fns) {
		try {
			fn(ownedTarget, data);
		} catch (e) {
			console.log(e);
		}
	}
}

export function initObservers() {
	if (isAppType('d2x')) {
		document.addEventListener('reddit', (handleRedditEvent: any), true);
		document.dispatchEvent(new CustomEvent('reddit.ready', {
			detail: {
				name: JSAPI_CONSUMER_NAME,
			},
		}));
	} else {
		watchForElements(['siteTable'], '.entry div.expando', addSelfTextObserver);

		if (isPageType('comments')) {
			addCommentsObserver(document.querySelector('.commentarea .sitetable'));

			watchForThings('comment', thing => {
				const sitetable: ?HTMLElement = thing.element.querySelector('.sitetable');

				// Comments without replies does not have `.sitetable`
				if (sitetable) {
					addCommentsObserver(sitetable);
				} else {
					waitForChild(thing.element.querySelector('.child'), '.sitetable').then(sitetable => {
						addCommentsObserver(sitetable);

						const comment = sitetable.querySelector('.thing');
						if (comment) registerElement('newComments', comment);
					});
				}
			});
		}
	}
}

export function newSitetable(siteTable: HTMLElement) {
	let sorter;
	if (document.contains(siteTable)) {
		const { height: viewportHeight } = getViewportSize();
		sorter = sortBy(([element]) => {
			const fromTop = element.getBoundingClientRect().top;
			return element.offsetParent ?
				(fromTop >= 0 ? fromTop : -fromTop + viewportHeight) :
				Infinity;
		});
	}

	return registerElement('siteTable', siteTable, sorter);
}

function addCommentsObserver(ele) {
	watchForFutureChildren(ele, '.thing', comment => {
		registerElement('newComments', comment);
	});
}

function addSelfTextObserver(ele) {
	watchForFutureChildren(ele, 'form', form => {
		registerElement('selfText', form);
	});
}
