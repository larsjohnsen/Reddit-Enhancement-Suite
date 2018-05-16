/* @flow */

import { isURLVisited } from '../../../environment';
import { Post } from '../../../utils';
import * as NewCommentCount from '../../newCommentCount';
import { Case } from '../Case';

export class CommentsOpened extends Case {
	static contexts = [Post];

	static text = 'Comments opened';

	static fields = ['comments page has been visited'];
	static slow = 2;

	static unique = true;

	trueText = 'comments opened';
	falseText = '¬ comments opened';

	async evaluate(thing: *) {
		if (await NewCommentCount.hasEntry(thing)) return true;

		const link = thing.getCommentsLink();
		return !!link && isURLVisited(link.href);
	}
}
