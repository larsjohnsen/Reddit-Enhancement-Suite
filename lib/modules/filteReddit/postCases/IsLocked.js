/* @flow */

import { Post } from '../../../utils';
import { Case } from '../Case';

export class IsLocked extends Case {
	static contexts = [Post];

	static text = 'Locked';

	static fields = ['post is locked'];
	static unique = true;

	evaluate(thing: *) {
		return thing.isLocked();
	}
}
