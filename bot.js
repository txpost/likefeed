var Twit = require('twit'),
	async = require('async'),
	request = require('request'),
	pg = require('pg'),
	moment = require('moment'),
	_ = require('lodash'),
	tumblr = require('tumblr.js');

// authenticate the Twitter API
var t = new Twit({
	consumer_key: process.env.TWIT_CONSUMER_KEY,
	consumer_secret: process.env.TWIT_CONSUMER_SECRET,
	access_token: process.env.TWIT_ACCESS_TOKEN,
	access_token_secret: process.env.TWIT_ACCESS_TOKEN_SECRET
});

// authenticate the Tumblr API
var tumb = tumblr.createClient({
  consumer_key: process.env.TUMB_CONSUMER_KEY,
  consumer_secret: process.env.TUMB_CONSUMER_SECRET,
  token: process.env.TUMB_ACCESS_TOKEN,
  token_secret: process.env.TUMB_ACCESS_TOKEN_SECRET
});


// get the max id from fav_tweets db so we can then query using since_id
getMaxID = function (cb) {
	pg.connect(process.env.DATABASE_URL, function (err, client) {
		if (!err) {
			
			var query = client.query('SELECT max(id) FROM fav_tweets');

			query.on('row', function (row) {

				var botData = {
					maxID: row.max
				};

				console.log(botData.maxID);

				cb(null, botData);
			});

			// console.log("connected to db");
		} else {
			console.log("there was an error connecting to db, ABORT.");
			console.log(err);
		};
	});
}

// get all new favorite tweets since last run 
getTweets = function (botData, cb) {
	t.get('favorites/list', {screen_name: "trevpost", since_id: botData.maxID}, function (err, data, response) {
		if (!err) {

			var botData = {
				tweetBatch: data
			};
			// console.log(botData.tweetBatch[0]);

			cb(null, botData);

		} else {
			console.log("There was an error getting a public Tweet. ABORT!");
			cb(err, botData);
		}
	});
}

// use this getTweets when populating the db for the first time
// getTweets = function (cb) {
// 	t.get('favorites/list', {screen_name: "trevpost"}, function (err, data, response) {
// 		if (!err) {

// 			var botData = {
// 				tweetBatch: data
// 			};

// 			cb(null, botData);

// 		} else {
// 			console.log("There was an error getting a public Tweet. ABORT!");
// 			cb(err, botData);
// 		}
// 	});
// }


insertTweets = function (botData, cb) {

	pg.connect(process.env.DATABASE_URL, function (err, client) {
		if (!err) {
			if (botData.tweetBatch[0] != undefined) {

				var queryText = "DELETE FROM fav_tweets WHERE id < (SELECT max(id) FROM fav_tweets);";

				// delete all entries except for max id 
				var query = client.query(queryText, function (err, result) {
					if (err) {
						console.log(err);
					};
				});

				console.log("entries deleted");

				_.each(botData.tweetBatch, function (tweet, index) {

					// format permalink
					var permalink = "http://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str;

					// format date
					var tweetDate = tweet.created_at;
					tweetDate = moment(tweetDate, 'dd MMM DD HH:mm:ss ZZ YYYY', 'en').format('YYYY-MM-DD');

					var tweetText = tweet.text;	
					tweetText = tweetText.replace(/[']/g, "");
					tweetText = tweetText.replace(/[^\x00-\x7F]/g, "");

					var tweetID = tweet.id_str;
					var tweetUsername = tweet.user.screen_name;
					var tweetPermalink = permalink;
					var tweetDate = tweetDate;
					
					// console.log("tweetText: " + tweetText);
					// console.log("tweetID: " + tweetID);
					// console.log("tweetUsername: " + tweetUsername);
					// console.log("tweetPermalink: " + tweetPermalink);
					// console.log("tweetDate: " + tweetDate);

					var queryText = "INSERT INTO fav_tweets (id, text, date, username, permalink) VALUES (" + tweetID + ",'" + tweetText + "','" + tweetDate + "','" + tweetUsername + "','" + tweetPermalink + "');";

					// var queryText = "INSERT INTO fav_tweets (id) VALUES (" + tweetID + ");";

					console.log(queryText);

					var query = client.query(queryText, function (err, result) {
						if (err) {
							console.log(err);
						};
					});

					console.log("inserted");
					
					if (index === botData.tweetBatch.length - 1) {
						cb(null, botData);
						console.log('end of tweets');
					}

				});	
			} else {
				console.log("botData.tweetBatch is empty, ABORT");
				cb(null, botData);
			}; 
			
			// console.log("connected to db");
		} else {
			console.log("there was an error connecting to db, ABORT.");
			console.log(err);
		};
	});
}


postTweets = function (botData, cb) {
	if (botData.tweetBatch[0] != undefined) {
		_.each(botData.tweetBatch, function (tweet, index) {

			// format permalink
			var permalink = "http://twitter.com/" + tweet.user.screen_name + "/status/" + tweet.id_str;

			// format date
			var tweetDate = tweet.created_at;
			tweetDate = moment(tweetDate, 'dd MMM DD HH:mm:ss ZZ YYYY', 'en').format('YYYY-MM-DD');

			var tweetID = tweet.id_str;
			var tweetUsername = tweet.user.screen_name;
			var tweetPermalink = permalink;
			var tweetDate = tweetDate;

			var byLine = "<p>(<a href='" + tweetPermalink + "'>twitter</a>)</p>";


			var tweetText = tweet.text;	
			tweetText = tweetText.replace(/[']/g, "");
			tweetText = tweetText.replace(/[^\x00-\x7F]/g, "");

			if (tweet.entities.media) {
				var postText = tweetText + "</p><p><img src='" + tweet.entities.media[0].media_url + "' /> " + byLine;
				// console.log(tweet.entities.media[0].media_url);
			} else {
				var postText = tweetText + " " + byLine;
			}

			console.log(postText);

			tumb.text("likefeed", { body: postText }, function (err, res) {
				if (err) {
					console.log("There was a problem posting to Tumblr, ABORT.");
				};
			});
			
			// console.log("tweetText: " + tweetText);
			// console.log("tweetID: " + tweetID);
			// console.log("tweetUsername: " + tweetUsername);
			// console.log("tweetPermalink: " + tweetPermalink);
			// console.log("tweetDate: " + tweetDate);

			console.log("posted");
			
			if (index === botData.tweetBatch.length - 1) {
				cb(null, botData);
				console.log('end of posts');
			}

		});
	} else {
		console.log("botData.tweetBatch is still empty, ABORT");
		cb(null, botData);
	};
	
}

endit = function (botData, cb) {
	console.log("that's the end");
}


// run each function in sequence
run = function () {
	async.waterfall([
		getMaxID,
		getTweets,
		insertTweets,
		postTweets,
		endit
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
}, 60000 * 60 * 2);