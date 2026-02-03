const fetch = require("node-fetch");

exports.main = async (params) => {
    try {
        const category = params.category || 'global';
        const publishDate = params.publishDate || new Date().toISOString().split('T')[0];
    
        const url = `https://publish-p168597-e1803019.adobeaemcloud.com/graphql/execute.json/GMR/next-news;category=${category};publishDate=${publishDate};`;
        
console.log('eeeeeeeeeeeeeurl:', url);
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
 