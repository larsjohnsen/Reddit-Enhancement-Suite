/* @flow */

import _ from 'lodash';
import { JSAPI_CONSUMER_NAME } from '../constants/jsapi';
import { filterMap } from './array';
import { frameThrottleQueuePositionReset } from './async';
import { downcast } from './flow';
import { currentSubreddit, regexes } from './location';

const elementMap = new WeakMap();
const things = new Set();
const SECRET_TOKEN = new class {}();

/**
 * Wrapper class around reddit's concept of a "Thing".
 * Use Thing.from or Thing.checkedFrom (fallible/infallible respectively) to construct a Thing.
 * Uniqueness is guaranteed, i.e. `Thing.from(element) === Thing.from(element)`.
 */
export class Thing {
	static bodyThingSelector = '.listing .thing, .linklisting .thing, .nestedlisting .thing, .search-result-link, .Post, .Comment';
	static thingSelector = '.thing, .search-result-link, .Post, .Comment';
	static entrySelector = '.entry, .search-result-link > :not(.thumbnail)';

	static thingsContainer(body: HTMLElement = document.body): HTMLElement {
		return (
			body.querySelector('.sitetable') ||
			_.last(Array.from(body.querySelectorAll('.search-result-listing')))
		);
	}

	static findThings(container?: HTMLElement = Thing.thingsContainer()): Thing[] {
		const potentialThings = [
			...(container.matches(Thing.thingSelector) ? [container] : []),
			...container.querySelectorAll(Thing.thingSelector),
		];
		return filterMap(potentialThings, ele => {
			const thing = Thing.from(ele);
			if (thing) return [thing];
		});
	}

	static thingElements(): HTMLElement[] {
		return Array.from(document.querySelectorAll(Thing.bodyThingSelector));
	}

	static things(): Thing[] {
		return Thing.thingElements().map(e => Thing.checkedFrom(e));
	}

	static visibleThingElements(): HTMLElement[] {
		return Thing.thingElements().filter(v => v.offsetParent);
	}

	static visibleThings(): Thing[] {
		return filterMap(Thing.visibleThingElements(), ele => {
			const thing = Thing.from(ele);
			if (thing) return [thing];
		});
	}

	static isMessage(element: HTMLElement): boolean {
		return element.classList.contains('message');
	}

	static isSubreddit(element: HTMLElement): boolean {
		//if (this.entry.expando) {
		//	return this.entry.expando.type === 'subreddit';
		//}
		return element.classList.contains('subreddit');
	}

	static isPost(element: HTMLElement): boolean {
		//if (this.entry.expando) {
		//	return this.entry.expando.type === 'post';
		//}
		return element.classList.contains('link') || element.classList.contains('search-result-link');
	}

	static isComment(element: HTMLElement): boolean {
		//if (this.entry.expando) {
		//	return this.entry.expando.type === 'comment';
		//}
		return element.classList.contains('comment') || element.classList.contains('was-comment');
	}

	element: HTMLElement;
	entry: HTMLElement;

	// may be set by filters
	filter: *;

	static checkedFrom(element: HTMLElement | Thing) {
		const thing = Thing.from(element);
		if (!thing) {
			throw new Error(`Could not construct Thing from ${String(element)}`);
		}
		//if (!(type instanceof thing)) {
		//	throw new Error(`Thing is ${thing.constructor.name}, but must be instance of ${type.name}`);
		//}
		return thing;
	}

	static from(element: ?HTMLElement | Thing): ?Thing {
		if (!element) return null;

		if (element instanceof Thing) return element;

		const thingElement = element.closest(Thing.thingSelector);
		if (!thingElement) return null;

		if (elementMap.has(thingElement)) return elementMap.get(thingElement);

		const constructor = (Thing.isComment(element) && Comment) ||
			Post; // TODO Extract other types from `Post`

		const thing = new constructor(SECRET_TOKEN, downcast(thingElement, HTMLElement));

		elementMap.set(thingElement, thing);
		things.add(thing);

		return thing;
	}

	constructor(token: typeof SECRET_TOKEN, thing: HTMLElement) {
		if (token !== SECRET_TOKEN) {
			throw new Error('Use Thing.from() or Thing.checkedFrom() instead of new Thing()');
		}

		this.element = thing;
		//this.entry = element.expando ? element : thing.querySelector(Thing.entrySelector) || thing;
		this.entry = thing.querySelector(Thing.entrySelector) || thing;
	}

	setFilter(filter: ?*) {
		this.filter = filter;
		this.element.classList.toggle('RESFiltered', !!filter);
	}

	getClosestVisible(includeSelf: boolean = true): ?Thing {
		if (includeSelf && this.isVisible()) return this;
		return this.getNext({ direction: 'down' }) || this.getNext({ direction: 'up' });
	}

	// FIXME Return value is instance of `type`
	getNext({ direction = 'down' }: {| direction?: 'up' | 'down' |} = {}, things: Thing[] = Thing.things(), type: * = Thing): any {
		let index = things.indexOf(this);
		let thing;

		do {
			index += direction === 'down' ? 1 : -1;
			thing = things[index];
			if (thing instanceof type && thing.isVisible()) return thing;
		} while (thing);
	}

	static _parseScore(scoreEle: HTMLElement): number {
		return parseInt(scoreEle.title || scoreEle.textContent, 10) || 0;
	}

	getScore(): ?number {
		//if (this.entry.expando) {
		//	// TODO
		//	return;
		//}
		const element = this._getActiveScoreElement();
		// parseInt() strips off the ' points' from comments
		return element && Thing._parseScore(element);
	}

	_getActiveScoreElement(): ?HTMLElement {
		return this.entry.querySelector('.tagline > .score');
	}

	getAllScoreElements(): Array<[HTMLElement, number]> {
		const toScoreTuple = ele => [ele, Thing._parseScore(ele)];
		return Array.from(this.entry.querySelectorAll('.tagline > .score')).map(toScoreTuple);
	}

	getAuthor(): ?string {
		//if (this.entry.expando) {
		//	return this.entry.expando.author;
		//}
		const data = this.element.getAttribute('data-author');
		if (data) {
			return data;
		}
		const element = this.getAuthorElement();
		return element && regexes.profile.exec(element.pathname)[1];
	}

	getAuthorUrl(): string {
		const author = this.getAuthor();
		if (author) {
			return `/user/${author}/`;
		}
		return '';
	}

	getAuthorElement(): ?HTMLAnchorElement {
		return (this.entry.querySelector('.tagline a.author, .search-author .author'): any);
	}

	getUserFlairText(): string {
		const element = this.getUserFlairElement();
		return element && element.textContent || '';
	}

	getUserFlairElement(): ?HTMLElement {
		return this.entry.querySelector('.tagline > .flair');
	}

	getUpvoteButton(): ?HTMLElement {
		return this._getVoteButton('div.up, div.upmod');
	}

	getDownvoteButton(): ?HTMLElement {
		return this._getVoteButton('div.down, div.downmod');
	}

	_getVoteButton(selector: string): ?HTMLElement {
		const previousSibling: HTMLElement = (this.entry.previousSibling: any);
		if (previousSibling.tagName === 'A') {
			return (previousSibling.previousSibling: any).querySelector(selector);
		} else {
			return previousSibling.querySelector(selector);
		}
	}

	getTimestamp(): ?Date {
		//if (this.entry.expando) {
		//	if (this.entry.expando.created) {
		//		return new Date(this.entry.expando.created);
		//	}
		//}
		const element = this.getTimestampElement();
		return element && new Date(element.getAttribute('datetime'));
	}

	getTimestampElement(): ?HTMLElement {
		return this.entry.querySelector('time');
	}

	getPostEditTimestamp(): number {
		//if (this.entry.expando) {
		//	if (this.entry.expando.edited) {
		//		return new Date(this.entry.expando.edited);
		//	}
		//}
		const element = this.getPostEditTimestampElement();
		return element && (Date.parse(element.getAttribute('datetime')) / 1000) || 0;
	}

	getPostEditTimestampElement(): ?HTMLElement {
		return this.entry.querySelector('time.edited-timestamp');
	}

	getFullname(): string {
		//if (this.entry.expando) {
		//	return this.entry.expando.id;
		//}
		return this.element.getAttribute('data-fullname') || '';
	}

	getUserattrsElement(): ?HTMLElement {
		return this.entry.querySelector('.userattrs');
	}

	getTaglineElement(): ?HTMLElement {
		return this.entry.querySelector('.tagline');
	}

	getPostTime(): string {
		//if (this.entry.expando) {
		//	const timestamp = this.getTimestamp();
		//	return timestamp ? timestamp.toLocaleString() : '';
		//}
		const element = this.getPostTimeElement();
		if (element) {
			return element.textContent;
		}
		return '';
	}

	getPostTimeElement(): ?HTMLElement {
		return this.entry.querySelector('.tagline time');
	}

	isDeleted(): boolean {
		//if (this.entry.expando) {
		//	return this.entry.expando.author === '[deleted]';
		//}
		return this.element.classList.contains('deleted');
	}

	isFiltered(): boolean {
		return !document.body.classList.contains('res-filters-disabled') &&
			this.element.classList.contains('RESFiltered');
	}

	isVisible(): boolean {
		return !this.isFiltered();
	}

	isSelected() {
		return this.element.classList.contains('res-selected');
	}

	isUpvoted() {
		//if (this.entry.expando) {
		//	return this.entry.expando.voteState === 1;
		//}
		//return this.entry.classList.contains('likes');
	}

	isDownvoted() {
		//if (this.entry.expando) {
		//	return this.entry.expando.voteState === -1;
		//}
		return this.entry.classList.contains('dislikes');
	}

	isUnvoted() {
		//if (this.entry.expando) {
		//	return this.entry.expando.voteState === 0;
		//}
		return this.entry.classList.contains('unvoted');
	}
}

export class Post extends Thing {
	_getActiveScoreElement(): ?HTMLElement {
			return this.element.querySelector([
				'.midcol.unvoted > .score.unvoted',
				'.midcol.likes > .score.likes',
				'.midcol.dislikes > .score.dislikes',
				'.search-score',
			].join(', '));
	}

	getAllScoreElements(): Array<[HTMLElement, number]> {
		const toScoreTuple = ele => [ele, Thing._parseScore(ele)];
		return Array.from(this.element.querySelectorAll('.midcol > .score, .search-score')).map(toScoreTuple);
	}

	isLinkPost(): boolean {
		//if (this.entry.expando) {
		//	return false; // TODO: await JSAPI returning outbound URL
		//}
		if (this.element.classList.contains('search-result-link')) {
			return !this.element.querySelector('a').classList.contains('self');
		} else {
			return !this.element.classList.contains('self');
		}
	}

	isSelfPost(): boolean {
		//if (this.entry.expando) {
		//	return false; // TODO: await JSAPI returning post type
		//}
		if (this.element.classList.contains('search-result-link')) {
			return this.element.querySelector('a').classList.contains('self');
		} else {
			return this.element.classList.contains('self');
		}
	}

	getTitle(): string {
		//if (this.entry.expando) {
		//	return this.entry.expando.title;
		//}
		const element = this.getTitleElement();
		return element && element.textContent || '';
	}

	getTitleElement(): ?HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}
		return (this.entry.querySelector('a.title, a.search-title') ||
			this.entry.querySelector('.title'): any);
	}

	getTitleUrl(): string {
		const element = this.getTitleElement();
		if (element) {
			return element.href;
		}
		return '';
	}

	getPostLink(): HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}
		return downcast(this.entry.querySelector('a.title, a.search-link'), HTMLAnchorElement);
	}

	getPostUrl(): string {
		return this.element.dataset.url || this.getPostLink().href;
	}

	getCommentsLink(): HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}

		return downcast(this.entry.querySelector('a.comments, a.search-comments'), HTMLAnchorElement);
	}

	getHideElement(): ?HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}

		return (this.entry.querySelector('.hide-button a, .unhide-button a'): any);
	}

	getSubreddit = _.once(function(): ?string {
		//if (this.entry.expando) {
		//	if (this.entry.expando.subreddit) {
		//		return this.entry.expando.subreddit.name;
		//	}
		//	return currentSubreddit();
		//}
		const data = this.element.getAttribute('data-subreddit');
		if (data) {
			return data;
		}
		const element = this.getSubredditLink();
		if (element) {
			const match = regexes.subreddit.exec(element.pathname);
			if (match) {
				return match[1];
			}
		} else {
			return currentSubreddit();
		}
	});

	getSubredditLink(): ?HTMLAnchorElement {
			return (this.entry.querySelector('.tagline a.subreddit, a.search-subreddit-link'): any);
	}

	getPostDomain(): string {
		//if (this.entry.expando()) {
		//	// TODO:
		//	return '';
		//}
		const data = this.element.getAttribute('data-domain');
		if (data) {
			return data;
		}

		const element = this.getPostDomainLink();
		if (element) {
			return element.textContent;
		}

		const text = this.getPostDomainText();
		if (text) {
			return text;
		}

		const subreddit = this.getSubreddit();
		if (subreddit) {
			return `self.${subreddit}`;
		}

		return 'reddit.com';
	}

	getPostDomainUrl(): string {
		//if (this.entry.expando) {
		//	return;
		//}
		const link = this.getPostDomainLink();
		if (link) {
			return link.href;
		}
		return `/domain/${this.getPostDomain()}/`;
	}

	getPostDomainLink(): ?HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}
		return (this.element.querySelector('.domain a'): any);
	}

	getPostDomainText(): string {
		//if (this.entry.expando) {
		//	// TODO
		//	return;
		//}
		const data = this.element.getAttribute('data-domain');
		if (data) {
			return data;
		}

		const element = this.element.querySelector('.domain');
		if (!element) return '';
		const text = element.textContent || '';
		return text.replace(/[\(\)\s]/g, '');
	}

	getCommentCount(): number {
		//if (this.entry.expando) {
		//	// TODO
		//	return -1;
		//}
		const element = this.getCommentCountElement();
		return element && parseInt(/\d+/.exec(
			element.textContent ||
			element.getAttribute('data-text') // In case noCtrlF is applied
		), 10) || 0;
	}

	getCommentCountElement(): ?HTMLElement {
		//if (this.entry.expando) {
		//	return;
		//}
		return this.element.querySelector('.buttons .comments');
	}

	getPostThumbnailUrl(): string {
		const thumbnail = this.getPostThumbnailElement();
		if (!thumbnail) return '';
		return thumbnail.src || '';
	}

	getPostThumbnailElement(): ?HTMLImageElement {
		return (this.element.querySelector('.thumbnail img'): any);
	}

	getPostFlairText(): string {
		//if (this.entry.expando) {
		//	return this.entry.expando.flair
		//		.filter(f => f.type === 'text')
		//		.map(f => f.text)
		//		.join(', ');
		//}
		const element = this.getPostFlairElement();
		return element && element.textContent || '';
	}

	getPostFlairElement(): ?HTMLElement {
		return this.entry.querySelector('.title > .linkflairlabel');
	}


	getCrosspostBadgeElement(): ?HTMLElement {
		return this.entry.querySelector('.crosspost-badge');
	}

	getRank(): ?number {
		const rank = parseInt(this.element.getAttribute('data-rank'), 10);
		if (!isNaN(rank)) return rank;
	}

	getRankElement(): ?HTMLElement {
		return this.element.querySelector('.rank');
	}

	//_hasFlair(type: string): boolean {
	//	return this.entry.expando && this.entry.expando.flair.some(f => f.type === type);
	//}

	isNSFW(): boolean {
		//if (this.entry.expando) {
		//	return this._hasFlair('nsfw');
		//}
		if (this.element.classList.contains('search-result')) {
			return !!this.entry.querySelector('.nsfw-stamp');
		}
		return this.element.classList.contains('over18');
	}

	isSpoiler(): boolean {
		//if (this.entry.expando) {
		//	return this._hasFlair('spoiler');
		//}
		if (this.element.classList.contains('search-result')) {
			return !!this.entry.querySelector('.spoiler-stamp');
		}
		return this.element.classList.contains('spoiler');
	}

	isCrosspost(): boolean {
		//if (this.entry.expando) {
		//	return false; // TODO
		//}
		return !!this.getCrosspostBadgeElement();
	}

	isLocked(): boolean {
		//if (this.entry.expando) {
		//	return false; // TODO
		//}
		if (this.element.classList.contains('search-result')) {
			return this.element.classList.contains('linkflair-locked');
		}
		return this.element.classList.contains('locked');
	}
}

export class Comment extends Thing {
	parent: ?Comment;
	children: Set<Comment> = new Set();

	constructor(token: *, thing: *, entry: *) {
		super(token, thing);

		this.parent = this.getParent();
		if (this.parent) {
			this.parent.children.add(this);
		}
	}

	isFiltered(alsoPartially: boolean = true): boolean {
		return !document.body.classList.contains('res-filters-disabled') &&
			(
				this.element.classList.contains('RESFiltered') &&
				!(alsoPartially && this.element.classList.contains('res-thing-has-visible-child'))
			);
	}

	isInHidden(): boolean {
		return !!(this.parent && this.parent.getClosest(function() {
			return this.isCollapsed() || this.element.classList.contains('res-children-hidden') || this.isFiltered(false);
		}));
	}

	isVisible(): boolean {
		return !(
			this.isFiltered() ||
			this.isInHidden()
		);
	}

	isContentVisible(): boolean {
		return !(
			this.isFiltered(false) ||
			this.isCollapsed() ||
			this.isInHidden()
		);
	}

	// `frameThrottleQueuePositionReset` ensures that children will be evaluated first
	refreshChildFilterVisibility = frameThrottleQueuePositionReset(() => {
		this.element.classList.toggle('res-thing-has-visible-child', Array.from(this.children).some(v => v.isVisible()));
	});

	getThreadTop(): Comment {
		//if (this.entry.expando) {
		//	if (this.entry.expando.isTopLevel) {
		//		return this;
		//	}

		//	if (this.parent) {
		//		return this.parent.getThreadTop();
		//	}

		//	return this;
		//}

		let thing = this; // eslint-disable-line consistent-this
		while (thing.parent) thing = thing.parent;
		return thing;
	}

	getParent(): ?Comment {
		//if (this.entry.expando) {
		//	if (this.entry.expando.isTopLevel) {
		//		return this;
		//	}

		//	if (this.entry.expando.parentId) {
		//		const parent = Thing.checkedFrom(document.querySelector(`.${this.entry.expando.parentId}`));
		//		return parent;
		//	}

		//	return;
		//}

		let current = this.element;
		while ((current = current.parentElement)) {
			if (current.classList.contains('thing')) return Thing.checkedFrom(downcast(current, HTMLElement));
		}
	}

	getParents(): Comment[] {
		const parents = [];
		let level = this; // eslint-disable-line consistent-this
		while ((level = level.parent)) parents.push(level);
		return parents;
	}

	getNextSibling(options: *): ?Comment {
		if (!this.element.parentElement) return null;

		const things = Array.from(this.element.parentElement.children)
			.filter(e => e.matches(Thing.thingSelector)).map(e => Thing.checkedFrom(e));

		return this.getNext(options, things, Comment);
	}

	getClosest(func: (...args: any) => ?Comment , ...args: mixed[]): ?Comment {
		const target = Reflect.apply(func, this, args);
		if (target) {
			return target;
		} else {
			if (this.parent) return this.parent.getClosest(func, ...args);
		}
	}

	isTopLevelComment(): boolean {
		//if (this.entry.expando) {
		//	return this.isComment() && this.entry.expando.isTopLevel;
		//}
		return !this.parent;
	}

	getCommentPermalink(): ?HTMLAnchorElement {
		//if (this.entry.expando) {
		//	return;
		//}

		return (this.entry.querySelector('a.bylink'): any);
	}

	getSubredditLink(): ?HTMLAnchorElement {
		// TODO: does .parent a.subreddit work?
		return (this.entry.querySelector('.parent a.subreddit, .tagline .subreddit a'): any);
	}

	getNumberOfChildren(): number {
		//if (this.entry.expando) {
		//	return 0; // TODO
		//}

		const numChildrenElem = this.element.querySelector('.numchildren');
		return numChildrenElem && parseInt((/(\d+)/).exec(numChildrenElem.textContent)[1], 10) || 0;
	}

	getCommentToggleElement(): ?HTMLElement {
		return this.entry.querySelector('.expand');
	}

	isCollapsed(): boolean {
		return this.element.classList.contains('collapsed');
	}
}
