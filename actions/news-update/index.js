const fetch = require("node-fetch");

exports.main = async (params) => {
    try {
        const category = params.category || 'global';
        const limit = params.limit || 3;
        const offset = params.offset || 0;

        let url;

        if (category !== 'global') {
        url = `https://publish-p168597-e1803019.adobeaemcloud.com/graphql/execute.json/GMR/news-list-api;category=${category};limit=${limit};offset=${offset}`;
        } else {
        url = `https://publish-p168597-e1803019.adobeaemcloud.com/graphql/execute.json/GMR/news-list-api;limit=${limit};offset=${offset}`;
        }
console.log(url);
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });
console.log(response.status);
        if (!response.ok) {
            return {
                statusCode: response.status,
                body: {
                    error: true,
                    message: `AEM API error: ${response.statusText}`,
                },
            };
        }

        const data = await response.json();

        return {
            statusCode: 200,
            body: {
                success: true,
                data: data
            }
        };

    } catch (err) {
        return {
            statusCode: 500,
            body: {
                error: true,
                message: err.message
            }
        };
    }
};
 