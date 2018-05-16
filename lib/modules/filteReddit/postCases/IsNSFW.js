/* @flow */

import { Post } from '../../../utils';
import { Case } from '../Case';

export class IsNSFW extends Case {
	static contexts = [Post];

	static text = 'NSFW';

	static fields = ['post is marked NSFW'];

	static unique = true;

	evaluate(thing: *) {
		return thing.isNSFW();
	}
}
