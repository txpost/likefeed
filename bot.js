var Twit = require('twit'),
	async = require('async'),
	request = require('request');

// authentication for the Twitter API
var t = new Twit({
	consumer_key: process.env.TWIT_CONSUMER_KEY,
	consumer_secret: process.env.TWIT_CONSUMER_SECRET,
	access_token: process.env.TWIT_ACCESS_TOKEN,
	access_token_secret: process.env.TWIT_ACCESS_TOKEN_SECRET
});

getTweet = function (cb) {
	t.get('favorites/list', {user_id: "trevpost", count: 1}, function (err, data, response) {
		if (!err) {
			console.log(data);
			var botData = {
				baseTweet: data[0].text,
				tweetID: data[0].id_str,
				tweetUsername: [0].user.screen_name
			};
			console.log("Tweet: " + botData.baseTweet);
			// cb(null, botData);
		} else {
			console.log("There was an error getting a public Tweet. ABORT!");
			cb(err, botData);
		}
	});
}

formatPost = function (botData, cb) {
	// body...
}

sendPost = function (botData, cb) {
	// body...
}


// run each function in sequence
run = function () {
	async.waterfall([
		getTweet,
		formatPost,
		sendPost
	],
	function (err, botData) {
		if (err) {
			console.log("There was an error posting to Tumblr: ", err);
		} else {
			console.log("Post successful!");
			console.log("Tweet: ", botData.tweetBlock);
		}
	});
}


// run every two hours: 60000 * 60 * 2
setInterval(function () {
	try {
		run();
	}
	catch (e) {
		console.log(e);
	}
}, 60000 * 1);