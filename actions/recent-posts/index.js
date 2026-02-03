const fetch = require("node-fetch");

exports.main = async (params) => {
    try {
        const category = params.category || 'press-release';
        const limit = params.limit || 3;
        console.log("______________________________________", category);
        
        const url = `https://publish-p168597-e1803019.adobeaemcloud.com/graphql/execute.json/GMR/recent-posts;category=${category};limit=${limit};`;
        const response = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            }
        });
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
 