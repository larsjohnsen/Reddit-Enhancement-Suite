/* @flow */

import { Case } from '../Case';
import * as ReadComments from '../../readComments';
import * as Modules from '../../../core/modules';
import { Comment } from '../../../utils';

export class IsRead extends Case {
	static contexts = [Comment];

	static text = 'Read';

	static fields = ['comment is read'];
	static get disabled(): boolean {
		return !Modules.isRunning(ReadComments);
	}

	static unique = true;

	evaluate(thing: *) {
		return ReadComments.isRead(thing);
	}
}
