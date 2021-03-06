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
getMaxTweet = function (cb) {
    var botData = {};

    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (!err) {
            var query = client.query('SELECT max(id) FROM fav_tweets');
            
            // assing the max id to the botData object
            query.on('row', function (row) {
                botData.maxID = row.max;                
                cb(null, botData);
            });
            
            done();
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

            // save all new tweet data in our global object
            botData.tweetBatch = data;
            cb(null, botData);

        } else {
            console.log("There was an error getting a public Tweet. ABORT!");
            cb(err, botData);
        }
    });
}


// add new tweet favorites to our database
insertTweets = function (botData, cb) {
    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (!err) {

            // check to see if there is atleast one new favorite tweet
            if (botData.tweetBatch[0] != undefined) {

                // insert new tweet ids into the db
                _.each(botData.tweetBatch, function (tweet, index) {
                    
                    var tweetID = parseInt(tweet.id_str);

                    var queryText = "INSERT INTO fav_tweets VALUES (" + tweetID + ");";

                    var query = client.query(queryText, function (err, result) {
                        if (err) {
                            console.log(err);
                        };
                    });
                    
                    if (index === botData.tweetBatch.length - 1) {
                        cb(null, botData);
                    }
                });

            } else {
                cb(null, botData);
            }; 
            done();
        } else {
            console.log("there was an error connecting to db, ABORT.");
            console.log(err);
        };
    });
}


// post new favorite tweets to tumblr
postTweets = function (botData, cb) {
    if (botData.tweetBatch[0] != undefined) {

        // post each tweet to tumblr
        _.each(botData.tweetBatch, function (tweet, index) {
            
            var tweetID = tweet.id_str;

            // get tweet embed code and post it to tumblr
            t.get('statuses/oembed', {id: tweetID}, function (err, data, response) {
                if (!err) {

                    // get embed code
                    botData.embed = data.html;

                    // post to tumblr using the text format
                    tumb.text("likefeed", { body: botData.embed }, function (err, res) {
                        if (err) {
                            console.log("There was a problem posting to Tumblr, ABORT.");
                        };
                    });
                };
            });
            
            if (index === botData.tweetBatch.length - 1) {
                console.log("new tweets posted")
                cb(null, botData);
            }
        });

    } else {
        console.log("no new tweets to post");
        cb(null, botData);
    };
    
}


// get the id of the youtube videos previously added to likefeed
getYtDb = function (botData, cb) {
    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (!err) {
            var query = client.query('SELECT * FROM yt_list;', function (err, result) {
                done();

                if (!err) {
                    botData.ytDb = [];

                    // add each id to our object so we can check for new videos later
                    _.each(result.rows, function (row, index) {
                        botData.ytDb.push(row.id);

                        if (index === result.rows.length - 1) {
                            cb(null, botData);
                        };
                    });

                } else {
                    console.log("there was a problem with the recent_yt query");
                };
            });
        } else {
            console.log("there was an error connecting to db, ABORT.");
            console.log(err);
        };
    });
}


// get the updated likefeed youtube playlist
getYtList = function (botData, cb) {
    var part = 'contentDetails';
    var maxResults = 10;
    var playlistId = 'PLDzcohiitLsLrUbewEtbysO-xCQQCsmBI';
    var ytKey = process.env.YT_KEY;
    var ytURL = "https://www.googleapis.com/youtube/v3/playlistItems?part=" + part + "&maxResults=" + maxResults + "&playlistId=" + playlistId + "&key=" + ytKey;

    request(ytURL, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
            botData.ytList = json;
            cb(null, botData);
        } else {
            console.log("there was a problem with the playlist" + error);
            cb(error, botData);
        };
    })
}


// select the videos from the updated playlist which haven't been added to likefeed yet
selectVideos = function (botData, cb) {
    botData.newVideos = [];

    // check each video on the youtube playlist
    _.each(botData.ytList.items, function (video, index) {
        var videoId = video.contentDetails.videoId;
        
        // save new videos to be added to our object and insert them into the db
        if (botData.ytDb.indexOf(videoId) == -1) {

            // save the video id so it can be posted to tumblr
            botData.newVideos.push(videoId);

            // insert the new id into our db so we know not to post it in the future
            pg.connect(process.env.DATABASE_URL, function (err, client, done) {
                if (!err) {
                    var queryText = "INSERT INTO yt_list VALUES ('" + videoId + "');";
                    var query = client.query(queryText, function (err, result) {
                        if (err) {
                            console.log(err);
                        };
                    });
                    done();
                } else {
                    console.log("there was an error connecting to db, ABORT.");
                    console.log(err);
                };
            });
        };

        if (index === botData.ytList.items.length - 1) {
            cb(null, botData);
        };
    });
}


// post new videos to tumblr
postVideos = function (botData, cb) {
    if (botData.newVideos[0] != undefined) {

        _.each(botData.newVideos, function (video, index) {
            var youtubeLink = "http://youtu.be/" + video;

            // post to tumblr using the video post type
            tumb.video("likefeed", { embed: youtubeLink }, function (err, res) {
                if (err) {
                    console.log("There was a problem posting to Tumblr, ABORT.");
                };
            });
            
            if (index === botData.newVideos.length - 1) {
                cb(null, botData);
                console.log('new youtube videos posted');
            }
        });

    } else {
        console.log("no new youtube videos to post");
        cb(null, botData);
    };
}


// get the songs previously added to the db
getScDb = function (botData, cb) {
    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (!err) {
            var query = client.query('SELECT * FROM sc_list;', function (err, result) {
                done();
                if (!err) {
                    botData.scDb = [];
                    
                    // save previously added songs to the object to be checked later
                    _.each(result.rows, function (row, index) {
                        botData.scDb.push(row.id);
                        if (index === result.rows.length - 1) {
                            cb(null, botData);
                        };
                    });

                } else {
                    console.log("there was a problem with the sc_list query");
                };
            });
        } else {
            console.log("there was an error connecting to db, ABORT.");
            console.log(err);
        };
    });
}


// get all songs from the soundcloud playlist
getScList = function (botData, cb) {
    var playlistId = 69029211
    var scClientId = process.env.SC_CLIENT_ID;
    var scURL = "http://api.soundcloud.com/playlists/" + playlistId + ".json?client_id=" + scClientId;

    request(scURL, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
            botData.scList = json;
            cb(null, botData);
        } else {
            console.log("there was a problem with the playlist" + error);
            cb(error, botData);
        };
    })
}


// identify new songs that need to be added to the db and posted to tumblr
selectSongs = function (botData, cb) {
    botData.newSongs = [];
    
    // check each song to see if it's new and insert it into our db if so
    _.each(botData.scList.tracks, function (song, index) {
        var songId = song.id;
        var songPermalink = song.permalink_url;
        if (botData.scDb.indexOf(songId) == -1) {

            // save the video permalink so it can be posted to tumblr
            botData.newSongs.push(songPermalink);

            // insert the new id into our db so we know not to post it in the future
            pg.connect(process.env.DATABASE_URL, function (err, client, done) {
                if (!err) {
                    var queryText = "INSERT INTO sc_list VALUES (" + songId + ");";
                    var query = client.query(queryText, function (err, result) {
                        if (err) {
                            console.log(err);
                        };
                    });
                    done();
                } else {
                    console.log("there was an error connecting to db, ABORT.");
                    console.log(err);
                };
            });
        };
        if (index === botData.scList.tracks.length - 1) {
            cb(null, botData);
        };
    });
}


// post all new songs to tumblr
postSongs = function (botData, cb) {
    if (botData.newSongs[0] != undefined) {
        
        _.each(botData.newSongs, function (song, index) {
            var scLink = song;

            // post to tumblr as an audio post type
            tumb.audio("likefeed", { external_url: scLink }, function (err, res) {
                if (err) {
                    console.log("There was a problem posting to Tumblr, ABORT.");
                };
            });
            
            if (index === botData.newSongs.length - 1) {
                cb(null, botData);
                console.log('new soundcloud songs posted');
            }
        });

    } else {
        console.log("no new soundcloud songs to post");
        cb(null, botData);
    };
}

getRedditDb = function (botData, cb) {

    pg.connect(process.env.DATABASE_URL, function (err, client, done) {
        if (!err) {
            var query = client.query('SELECT * FROM fav_reddits;', function (err, result) {
                done();
                if (!err) {
                    botData.redditDb = [];
                    
                    // save previously added favorites to the object to be checked later
                    _.each(result.rows, function (row, index) {
                        botData.redditDb.push(row.created);
                        if (index === result.rows.length - 1) {
                            cb(null, botData);
                        };
                    });

                } else {
                    console.log("there was a problem with the fav_reddits query");
                };
            });
        } else {
            console.log("there was an error connecting to db, ABORT.");
            console.log(err);
        };
    });
}

getReddit = function (botData, cb) {

    var url = "http://www.reddit.com/user/txpost/saved.json?feed=" + process.env.REDDIT_FEED + "&user=txpost";

    request(url, function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var json = JSON.parse(body);
            botData.redditFavs = json;
            cb(null, botData);
        } else {
            console.log(response.statusCode);
            console.log("there was a problem with the reddit saved list" + error);
            cb(error, botData);
        };
    })
}

selectReddit = function (botData, cb) {
    var favUrl,
        favTitle,
        favDomain,
        favCreated;

    botData.newReddits = [];
    
    // check each song to see if it's new and insert it into our db if so
    _.each(botData.redditFavs.data.children, function (fav, index) {
        favUrl = fav.data.url;
        favTitle = fav.data.title;
        favDomain = fav.data.domain;
        favCreated = fav.data.created;
        favPermalink = fav.data.permalink;

        // n = 12345;

        // console.log(botData.redditDb.indexOf("" + n));

        if (botData.redditDb.indexOf("" + favCreated) == -1) {

            // save the video permalink so it can be posted to tumblr
            botData.newReddits.push([favDomain, favUrl, favTitle, favPermalink]);

            // insert the new id into our db so we know not to post it in the future
            pg.connect(process.env.DATABASE_URL, function (err, client, done) {
                if (!err) {
                    var queryText = "INSERT INTO fav_reddits VALUES (" + favCreated + ");";
                    var query = client.query(queryText, function (err, result) {
                        if (err) {
                            console.log(err);
                        };
                    });
                    done();
                } else {
                    console.log("there was an error connecting to db, ABORT.");
                    console.log(err);
                };
            });
        };
        if (index === botData.redditFavs.data.children.length - 1) {
            cb(null, botData);
        };
    });
}

postReddit = function (botData, cb) {
    var domain,
        url,
        title,
        permalink,
        text;

    if (botData.newReddits[0] != undefined) {
        
        _.each(botData.newReddits, function (fav, index) {
            domain = fav[0];
            url = fav[1];
            title = fav[2];
            permalink = fav[3];

            text = "<p>" + url + "</p><p><a href='http://reddit.com" + permalink + "'>- reddit</a></p>";
            // console.log(text);

            // post to tumblr using the text format
            tumb.text("likefeed", { title: title, body: text }, function (err, res) {
                if (err) {
                    console.log("error ", err);
                };
            });
            
            if (index === botData.newReddits.length - 1) {
                cb(null, botData);
                console.log('new reddits posted');
            }
        });

    } else {
        console.log("no new reddits to post");
        cb(null, botData);
    };
}


endit = function (botData, cb) {
    console.log("that's the end");
}


// run each function in sequence
run = function () {
    async.waterfall([
        getMaxTweet,
        getTweets,
        insertTweets,
        postTweets,
        getYtDb,
        getYtList,
        selectVideos,
        postVideos,
        getScDb,
        getScList,
        selectSongs,
        postSongs,
        getRedditDb,
        getReddit,
        selectReddit,
        postReddit,
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


// run every 24 hours: 60000 * 60 * 24
setInterval(function () {
    try {
        run();
    }
    catch (e) {
        console.log(e);
    }
}, 60000 * 60 * 24);