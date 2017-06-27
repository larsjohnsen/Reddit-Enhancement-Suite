/* @flow */

import _ from 'lodash';
import { Host } from '../../core/host';
import { ajax } from '../../environment';

export default new Host('vreddit', {
	name: 'v.redd.it',
	domains: ['v.redd.it'],
	permissions: ['https://v.redd.it/*'],
	attribution: false,
	detect: ({ pathname }) => pathname.slice(1),
	async handleLink(href, id) {
		const mpd = await ajax({ url: `https://v.redd.it/${id}/DASHPlaylist.mpd` });
		const manifest = new DOMParser().parseFromString(mpd, 'text/xml');
		const reps = Array.from(manifest.querySelectorAll('Representation'));
		const sources = _.sortBy(reps, rep => parseInt(rep.getAttribute('bandwidth'), 10))
			.reverse()
			.map(rep => rep.querySelector('BaseURL'))
			.map(baseUrl => ({
				source: `https://v.redd.it/${id}/${baseUrl.textContent}`,
				type: 'video/mp4',
			}));

		// todo audio stream is segmented :(

		return {
			type: 'VIDEO',
			controls: false,
			loop: true,
			muted: true,
			sources,
		};
	},
});
