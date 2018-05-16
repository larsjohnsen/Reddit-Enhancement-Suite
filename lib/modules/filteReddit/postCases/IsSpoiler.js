/* @flow */

import { Post } from '../../../utils';
import { Case } from '../Case';

export class IsSpoiler extends Case {
	static contexts = [Post];

	static text = 'Spoiler';

	static fields = ['post is marked spoiler'];

	static unique = true;

	evaluate(thing: *) {
		return thing.isSpoiler();
	}
}
