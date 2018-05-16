/* @flow */

import { Case } from '../Case';
import { Comment } from '../../../utils';

export class IsDeleted extends Case {
	static contexts = [Comment];

	static text = 'Deleted';

	static fields = ['comment is deleted'];

	static unique = true;

	evaluate(thing: *) {
		return thing.isDeleted();
	}
}
